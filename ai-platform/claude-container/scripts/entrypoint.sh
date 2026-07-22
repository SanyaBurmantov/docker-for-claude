#!/bin/bash

# The container starts as root only long enough to fix up the named volumes, then
# drops to `claude` for good. Docker creates a fresh volume owned by root:root, and
# claude-auth / opencode-* all mount under /home/claude, so without this the agent
# cannot write its own config. Everything below this block runs unprivileged.
if [ "$(id -u)" = "0" ]; then
  chown -R claude:claude /home/claude
  exec gosu claude "$0" "$@"
fi

CONFIG_DIR="${CLAUDE_CONFIG_DIR:-/home/claude/.claude}"
mkdir -p "$CONFIG_DIR"

# Rescue a config written by a container from before CLAUDE_CONFIG_DIR was set,
# so an existing login is not thrown away on the upgrade rebuild.
if [ -f "$HOME/.claude.json" ] && [ ! -e "$CONFIG_DIR/.claude.json" ]; then
  mv "$HOME/.claude.json" "$CONFIG_DIR/.claude.json"
fi

# The token already survives in the volume, but without .claude.json the CLI has
# no hasCompletedOnboarding flag and greets an authorised user with the login
# wizard anyway. Seeding the flag skips it; Claude fills in the rest of the file.
if [ -s "$CONFIG_DIR/.credentials.json" ] && [ ! -e "$CONFIG_DIR/.claude.json" ]; then
  echo '{"hasCompletedOnboarding": true}' > "$CONFIG_DIR/.claude.json"
  chmod 600 "$CONFIG_DIR/.claude.json"
fi

# `claude` now shares the host user's uid, so ownership normally lines up. Projects
# created before that (owned by root) or checked out by another host user would still
# trip "detected dubious ownership", so keep trusting every path under /workspace.
git config --global --add safe.directory '*'

# Git escapes non-ASCII bytes in paths as octal ("\320\277\321\200...") unless told
# otherwise, so a file named ????????????.txt reaches the web UI unreadable.
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8

# Git-over-HTTPS credentials live in the claude-auth volume so they survive rebuilds;
# the file is written via the web UI (System ??? Git credentials)
git config --global credential.helper 'store --file /home/claude/.claude/.git-credentials'

# Claude Code hooks: report "waiting for input" / "finished" events so the web UI
# can notify the user. Created only once ??? the settings file lives in the volume,
# so manual edits are preserved.
SETTINGS="$CONFIG_DIR/settings.json"
if [ ! -f "$SETTINGS" ]; then
cat > "$SETTINGS" << 'EOF'
{
  "hooks": {
    "Notification": [
      { "hooks": [ { "type": "command", "command": "echo \"$(date +%s)|notification|$(basename \"$PWD\")\" >> /tmp/claude-events.log" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "echo \"$(date +%s)|stop|$(basename \"$PWD\")\" >> /tmp/claude-events.log" } ] }
    ]
  }
}
EOF
fi

# --------------------------------------------------
# Auto-start Headroom compression proxy
# --------------------------------------------------
if ! curl -sf http://127.0.0.1:8787/livez >/dev/null 2>&1; then
  nohup headroom proxy >/tmp/headroom-proxy.log 2>&1 &
  for _ in $(seq 1 40); do
    if curl -sf http://127.0.0.1:8787/readyz >/dev/null 2>&1; then
      echo "[OK] Headroom proxy ready (PID: $(pgrep -xf '.*headroom proxy' || echo unknown))"
      break
    fi
    sleep 0.5
  done
  if ! curl -sf http://127.0.0.1:8787/livez >/dev/null 2>&1; then
    echo "[WARN] Headroom proxy not started — check /tmp/headroom-proxy.log"
  fi
fi

echo "Claude Code container ready"
echo "Projects are in /workspace"
echo "Run: claude"
tail -f /dev/null
