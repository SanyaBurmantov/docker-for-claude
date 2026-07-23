FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# ubuntu:24.04 leaves LANG unset, so everything here runs in the C locale, where a
# byte above 0x7F is not a character. Typing "привет" at a bash prompt echoes back
# corrupted because readline mangles the leading byte of each multi-byte sequence.
# glibc ships C.UTF-8 built in, so no locales package or locale-gen is needed.
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y \
    curl ca-certificates gnupg sudo git vim tmux \
    xz-utils gosu python3 \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# opencode: a second coding agent, so a project is not tied to one model vendor.
# It keeps its own auth per provider (`opencode auth login`) under the XDG dirs
# below, both of which are mounted as volumes in docker-compose.
RUN npm install -g opencode-ai

# /workspace is a bind mount, and a bind mount carries the host's numeric uid/gid
# straight through: a file written here as uid 0 is root-owned on the host too, and
# the host user cannot edit it (WebStorm reports "failed to change read-only status").
# Building `claude` with the host's ids makes ownership line up on both sides.
# ubuntu:24.04 ships its own `ubuntu` user squatting on uid 1000, so it goes first.
ARG HOST_UID=1000
ARG HOST_GID=1000

RUN if id ubuntu >/dev/null 2>&1; then userdel -r ubuntu; fi && \
    if ! getent group ${HOST_GID} >/dev/null; then groupadd -g ${HOST_GID} claude; fi && \
    useradd -m -u ${HOST_UID} -g ${HOST_GID} -s /bin/bash claude && \
    echo "claude:claude" | chpasswd && \
    usermod -aG sudo claude && \
    echo "claude ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Default opencode config with DashScope/Qwen provider. Lives in the image so that
# the first `docker compose up` initialises the empty `opencode-config` volume with it.
RUN mkdir -p /home/claude/.config/opencode
COPY opencode.json /home/claude/.config/opencode/opencode.json
RUN chown -R ${HOST_UID}:${HOST_GID} /home/claude/.config

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOME=/home/claude

# Claude Code splits its state in two: the config dir (.credentials.json,
# settings.json, sessions) and $HOME/.claude.json (onboarding flag, account).
# Only the first sat on the claude-auth volume, so a rebuild wiped .claude.json
# and the CLI re-ran its first-run login wizard. Pointing the config dir at the
# volume puts both files inside it. docker exec inherits this from the image
# config, so the tmux server started by the backend picks it up too.
ENV CLAUDE_CONFIG_DIR=/home/claude/.claude

ENTRYPOINT ["/entrypoint.sh"]
