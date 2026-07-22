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

# Headroom: an optional token-compression proxy that Claude Code can run behind
# (see the `claude-hr` launcher and the `claude-headroom` agent). Installed with uv
# into a world-readable location so the `headroom` binary is on the `claude` user's
# PATH — the build runs as root, but the container runs as `claude`. Only the base
# package: the proxy needs fastapi/uvicorn/httpx, not the heavy ML extras behind
# `[all]` (torch/CUDA), which would add gigabytes for compression we do not use.
# The tool venv is pinned to the system python3 so its interpreter path stays valid
# for every user, and the uv cache is dropped to keep the layer small.
ENV UV_TOOL_DIR=/opt/uv/tools
ENV UV_TOOL_BIN_DIR=/usr/local/bin
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh && \
    uv tool install --python /usr/bin/python3 headroom-ai \
      --with fastapi --with uvicorn --with 'httpx[http2]' && \
    chmod -R a+rX /opt/uv && rm -rf /root/.cache/uv

# Output-token reduction: trim what the model writes back (verbosity steering,
# effort routing) via headroom's proxy. On by default so every claude-hr /
# headroom proxy invocation cuts output tokens without extra flags.
ENV HEADROOM_OUTPUT_SHAPER=1
ENV HEADROOM_VERBOSITY_LEVEL=3

# claude-hr: launches Claude Code behind the Headroom proxy. Kept as a real binary
# on PATH so the backend agent registry can spawn it exactly like `claude`.
COPY scripts/claude-hr /usr/local/bin/claude-hr
RUN chmod +x /usr/local/bin/claude-hr

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
