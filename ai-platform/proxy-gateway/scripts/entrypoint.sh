#!/bin/bash

if [ -z "$PROXY_HOST" ] || [ -z "$PROXY_PORT" ] || [ -z "$PROXY_USER" ] || [ -z "$PROXY_PASS" ]; then
    echo "ERROR: PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS must be set"
    exit 1
fi

set +e

echo "Generating redsocks config from template..."
sed -e "s/PROXY_HOST_PLACEHOLDER/$PROXY_HOST/g" \
    -e "s/PROXY_PORT_PLACEHOLDER/$PROXY_PORT/g" \
    -e "s/PROXY_USER_PLACEHOLDER/$PROXY_USER/g" \
    -e "s/PROXY_PASS_PLACEHOLDER/$PROXY_PASS/g" \
    /etc/redsocks.conf.template > /etc/redsocks.conf

echo "Starting redsocks..."
/usr/sbin/redsocks -c /etc/redsocks.conf &
REDSOCKS_PID=$!

sleep 1

echo "Configuring iptables rules..."

# Create REDSOCKS chain
iptables -t nat -N REDSOCKS 2>/dev/null || true
iptables -t nat -F REDSOCKS

# Do not redirect traffic to the proxy itself
iptables -t nat -A REDSOCKS -d "$PROXY_HOST" -j RETURN

# Do not redirect private/local networks
for NET in 0.0.0.0/8 10.0.0.0/8 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
    iptables -t nat -A REDSOCKS -d "$NET" -j RETURN
done

# Redirect all remaining TCP traffic to redsocks
iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-port 12345

# Apply to OUTPUT chain
iptables -t nat -A OUTPUT -p tcp -j REDSOCKS

# Block UDP (except DNS port 53) and ICMP
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p udp -j DROP
iptables -A OUTPUT -p icmp -j DROP

if kill -0 "$REDSOCKS_PID" 2>/dev/null; then
    echo "redsocks is running (PID: $REDSOCKS_PID)"
else
    echo "WARNING: redsocks failed to start — kill switch active, traffic is blocked"
fi

echo "Proxy gateway ready. All container traffic routed through proxy."

tail -f /dev/null
