#!/bin/bash
set -e

# ============================================================
# Claude Docker Environment - Entrypoint
# ============================================================

# Validate required env vars
for var in PROXY_HOST PROXY_PORT PROXY_USER PROXY_PASS; do
    if [ -z "${!var}" ]; then
        echo "ERROR: $var is not set"
        exit 1
    fi
done

echo "=== Claude Docker Environment ==="
echo "Proxy: ${PROXY_HOST}:${PROXY_PORT}"
echo "User:  ${PROXY_USER}"

# --------------------------------------------------
# 1. Generate redsocks config
# --------------------------------------------------
cat > /etc/redsocks.conf << EOF
base {
    log_debug = off;
    log_info = on;
    log = stderr;
    daemon = off;
    redirector = iptables;
}

redsocks {
    local_ip = 127.0.0.1;
    local_port = 12345;
    ip = ${PROXY_HOST};
    port = ${PROXY_PORT};
    type = http-connect;
    login = "${PROXY_USER}";
    password = "${PROXY_PASS}";
}
EOF

# --------------------------------------------------
# 2. Setup iptables rules (transparent proxy + kill switch)
# --------------------------------------------------
setup_iptables() {
    # Flush existing rules
    iptables -t nat -F 2>/dev/null || true
    iptables -F 2>/dev/null || true

    # Create REDSOCKS chain
    iptables -t nat -N REDSOCKS 2>/dev/null || true
    iptables -t nat -F REDSOCKS 2>/dev/null || true

    # Don't redirect traffic to the proxy server itself
    iptables -t nat -A REDSOCKS -d ${PROXY_HOST} -j RETURN

    # Don't redirect local/private networks
    for net in 0.0.0.0/8 10.0.0.0/8 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
        iptables -t nat -A REDSOCKS -d $net -j RETURN
    done

    # Redirect all other TCP traffic to redsocks
    iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12345

    # Apply to OUTPUT chain (traffic from container itself)
    iptables -t nat -A OUTPUT -p tcp -j REDSOCKS

    # Block all outgoing UDP except DNS (prevents DNS leaks)
    iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
    iptables -A OUTPUT -p udp -j DROP

    # Block all ICMP (prevent ping-based leaks)
    iptables -A OUTPUT -p icmp -j DROP

    echo "[OK] iptables rules applied"
}

# --------------------------------------------------
# 3. Start services
# --------------------------------------------------
echo "Starting redsocks..."
redsocks -c /etc/redsocks.conf &
REDSOCKS_PID=$!
sleep 1

if kill -0 $REDSOCKS_PID 2>/dev/null; then
    echo "[OK] redsocks running (PID: $REDSOCKS_PID)"
else
    echo "[WARN] redsocks failed to start - internet will be blocked (kill switch active)"
fi

echo "Setting up iptables..."
setup_iptables

echo "Starting Xvfb..."
Xvfb :0 -screen 0 1920x1080x24 &
sleep 1

echo "Starting XFCE desktop..."
startxfce4 &
sleep 2

echo "Starting x11vnc..."
x11vnc -display :0 -forever -shared -rfbport 5900 \
    -passwd "${VNC_PASSWORD:-claude}" \
    -bg -o /tmp/x11vnc.log
sleep 1

echo "Starting noVNC..."
/opt/novnc/utils/novnc_proxy \
    --vnc localhost:5900 \
    --listen 6080 \
    --web /opt/novnc &
NOVNC_PID=$!
sleep 1

# --------------------------------------------------
# 4. Create desktop launcher for Firefox with proxy
# --------------------------------------------------
mkdir -p /home/claude/Desktop
cat > /home/claude/Desktop/firefox.desktop << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Firefox
Exec=firefox --no-sandbox
Icon=firefox
Terminal=false
EOF
chmod +x /home/claude/Desktop/firefox.desktop
chown -R claude:claude /home/claude/Desktop

# Set Firefox proxy settings for non-proxied contexts
mkdir -p /home/claude/.mozilla/firefox
cat > /home/claude/.mozilla/firefox/proxy.js << EOF
pref("network.proxy.type", 1);
pref("network.proxy.http", "${PROXY_HOST}");
pref("network.proxy.http_port", ${PROXY_PORT});
pref("network.proxy.ssl", "${PROXY_HOST}");
pref("network.proxy.ssl_port", ${PROXY_PORT});
pref("network.proxy.share_proxy_settings", true);
pref("network.proxy.no_proxies_on", "localhost,127.0.0.1");
pref("network.proxy.socks", "");
pref("network.proxy.socks_port", 0);
EOF
chown -R claude:claude /home/claude/.mozilla

# --------------------------------------------------
# 5. Verify setup
# --------------------------------------------------
echo ""
echo "============================================"
echo " Claude Docker Environment is READY!"
echo "============================================"
echo " noVNC:  http://localhost:6080"
echo " VNC:    localhost:5900 (password: ${VNC_PASSWORD:-claude})"
echo ""
echo " To enter the container:"
echo "   docker exec -it claude-env bash"
echo ""
echo " Proxy status: checking..."
echo ""

# Background proxy connectivity check
(
sleep 3
IP_CHECK=$(curl -s --max-time 10 https://api.ipify.org 2>/dev/null || echo "failed")
if [ "$IP_CHECK" = "${PROXY_HOST}" ]; then
    echo "[OK] Proxy is working. External IP: $IP_CHECK"
elif [ "$IP_CHECK" = "failed" ]; then
    echo "[WARN] Proxy check timed out. The proxy may be unreachable."
    echo "       Check PROXY_HOST and PROXY_PORT in .env"
else
    echo "[WARN] Proxy IP mismatch. Got: $IP_CHECK, Expected: ${PROXY_HOST}"
fi
) &

# --------------------------------------------------
# 6. Keep container alive
# --------------------------------------------------
cleanup() {
    echo "Shutting down..."
    kill $REDSOCKS_PID $NOVNC_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# Wait for any background process to exit
wait
