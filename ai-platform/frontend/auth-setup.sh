#!/bin/sh
# Runs from /docker-entrypoint.d/ at nginx startup.
# If UI_PASSWORD is set, enable HTTP basic auth for the whole UI (API and WS included).
if [ -n "$UI_PASSWORD" ]; then
    htpasswd -bc /etc/nginx/.htpasswd "${UI_USER:-admin}" "$UI_PASSWORD"
    cat > /etc/nginx/auth.conf << 'EOF'
auth_basic "AI Platform";
auth_basic_user_file /etc/nginx/.htpasswd;
EOF
    echo "Basic auth enabled for user ${UI_USER:-admin}"
else
    : > /etc/nginx/auth.conf
    echo "Basic auth disabled (UI_PASSWORD not set)"
fi
