#!/bin/bash
set -e

# No manual Firefox proxy config: the gateway (redsocks + iptables) transparently
# routes all traffic through the authenticated proxy, so Firefox works out of the box.

# The browser-profile (.mozilla) and browser-config (.config) named volumes are
# created root-owned on first run. XFCE and Firefox run as user claude and can't
# write into root-owned dirs, so fix ownership before anything starts.
echo "Fixing home directory ownership..."
chown -R claude:claude /home/claude

mkdir -p /var/log/supervisor

# supervisord (PID 1) starts Xvfb, XFCE, x11vnc and noVNC and keeps them alive.
# See supervisord.conf for start ordering and the wait-for-display guards.
echo "Starting services under supervisor — VNC on 5900, noVNC on 6080..."
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
