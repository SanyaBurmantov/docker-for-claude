FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update && apt-get install -y \
    xfce4 xfce4-goodies xvfb x11vnc dbus-x11 x11-utils \
    curl ca-certificates bzip2 xz-utils git \
    sudo supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install Firefox from Mozilla
RUN curl -L -o /tmp/firefox.tar.xz "https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=en-US" && \
    tar xf /tmp/firefox.tar.xz -C /opt/ && \
    ln -sf /opt/firefox/firefox /usr/bin/firefox && \
    rm /tmp/firefox.tar.xz

# noVNC from GitHub
RUN apt-get update && apt-get install -y python3-pip && \
    git clone --depth 1 https://github.com/novnc/noVNC.git /opt/novnc && \
    git clone --depth 1 https://github.com/novnc/websockify.git /opt/novnc/utils/websockify && \
    pip3 install --break-system-packages numpy && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash claude && \
    echo "claude:claude" | chpasswd && \
    chown -R claude:claude /home/claude

# noVNC serves vnc.html; make the bare URL (http://host:9901/) redirect to it.
RUN printf '%s\n' \
    '<!DOCTYPE html>' \
    '<html lang="en">' \
    '<head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=vnc.html"></head>' \
    '<body><a href="vnc.html">Open noVNC</a></body>' \
    '</html>' > /opt/novnc/index.html

# Firefox shortcut on the XFCE desktop (used for Claude OAuth login).
RUN mkdir -p /home/claude/Desktop && \
    printf '%s\n' \
    '[Desktop Entry]' \
    'Name=Firefox' \
    'Comment=Web Browser' \
    'Exec=firefox --no-sandbox' \
    'Icon=firefox' \
    'Terminal=false' \
    'Type=Application' \
    'Categories=Network;WebBrowser;' > /home/claude/Desktop/firefox.desktop && \
    chmod +x /home/claude/Desktop/firefox.desktop && \
    chown -R claude:claude /home/claude/Desktop

COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOME=/home/claude
ENV DISPLAY=:0

EXPOSE 5900 6080

ENTRYPOINT ["/entrypoint.sh"]
