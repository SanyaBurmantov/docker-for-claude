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
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

RUN useradd -m -s /bin/bash claude && \
    echo "claude:claude" | chpasswd && \
    usermod -aG sudo claude && \
    echo "claude ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

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
