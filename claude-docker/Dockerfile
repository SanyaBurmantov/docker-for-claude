FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update && apt-get install -y \
    xfce4 xfce4-goodies \
    xvfb x11vnc \
    redsocks iptables curl wget net-tools iproute2 dnsutils \
    bzip2 xz-utils \
    git vim nano sudo \
    ca-certificates gnupg \
    supervisor \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install noVNC from GitHub for latest version
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/novnc && \
    git clone --depth 1 https://github.com/novnc/websockify.git /opt/novnc/utils/websockify && \
    pip3 install --break-system-packages numpy

# Install Firefox directly from Mozilla (apt package is just a snap shim)
RUN curl -L -o /tmp/firefox.tar.xz "https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=en-US" && \
    tar xf /tmp/firefox.tar.xz -C /opt/ && \
    ln -sf /opt/firefox/firefox /usr/bin/firefox && \
    rm /tmp/firefox.tar.xz

# Install Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    node --version && npm --version

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create claude user
RUN useradd -m -s /bin/bash claude && \
    echo "claude:claude" | chpasswd && \
    usermod -aG sudo claude && \
    echo "claude ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Create workspace directory
RUN mkdir -p /workspace && chown claude:claude /workspace

# Copy scripts and configs
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set environment variables for claude user
ENV HOME=/home/claude
ENV DISPLAY=:0

EXPOSE 5900 6080

ENTRYPOINT ["/entrypoint.sh"]
