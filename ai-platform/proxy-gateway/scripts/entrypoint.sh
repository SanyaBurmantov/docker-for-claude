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

echo "Starting redsocks (supervised)..."
(
    while true; do
        /usr/sbin/redsocks -c /etc/redsocks.conf
        echo "redsocks exited (code $?), restarting in 2s..."
        sleep 2
    done
) &

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

# Block UDP (except DNS) and ICMP.
# Loopback must be allowed explicitly: Docker's embedded DNS (127.0.0.11:53)
# is DNAT'ed to a random high loopback port BEFORE this filter runs, so a
# plain "--dport 53 ACCEPT" never matches it and all DNS resolution dies.
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p udp -j DROP
iptables -A OUTPUT -p icmp -j DROP

# :3039 is port 12345 in hex — redsocks' local listener
if grep -q ':3039' /proc/net/tcp; then
    echo "redsocks is listening on 127.0.0.1:12345"
else
    echo "WARNING: redsocks is not listening — kill switch active, traffic is blocked"
fi

echo "Proxy gateway ready. All container traffic routed through proxy."

tail -f /dev/null
