#!/bin/bash

# No manual Firefox proxy config: the gateway (redsocks + iptables) transparently
# routes all traffic through the authenticated proxy, so Firefox works out of the box.

echo "Starting Xvfb..."
Xvfb :0 -screen 0 1920x1080x24 &
sleep 1

echo "Fixing home directory ownership..."
chown -R claude:claude /home/claude

echo "Starting desktop environment as user claude..."
su - claude -c "
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export DISPLAY=:0
startxfce4
" &
sleep 4

echo "Starting x11vnc..."
x11vnc -display :0 -forever -shared -rfbport 5900 -passwd "${VNC_PASSWORD:-claude}" -noxdamage &
sleep 1

echo "Starting noVNC..."
/opt/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
sleep 1

cat > /opt/novnc/index.html << 'REDIRECT'
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=vnc.html"></head>
<body><a href="vnc.html">Open noVNC</a></body>
</html>
REDIRECT

echo "Creating Firefox desktop shortcut..."
mkdir -p /home/claude/Desktop
cat > /home/claude/Desktop/firefox.desktop << EOF
[Desktop Entry]
Name=Firefox
Comment=Web Browser
Exec=firefox --no-sandbox
Icon=firefox
Terminal=false
Type=Application
Categories=Network;WebBrowser;
EOF
chmod +x /home/claude/Desktop/firefox.desktop
chown -R claude:claude /home/claude/Desktop

echo "Switching to claude user for interactive use..."
echo "Browser container ready ??? VNC on 5900, noVNC on 6080"

# Keep container alive and switch to claude user for any interactive commands
tail -f /dev/null
