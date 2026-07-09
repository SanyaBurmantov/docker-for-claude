#!/bin/bash

# Projects in /workspace are owned by the host user while git runs as root here;
# without this every git command fails with "detected dubious ownership"
git config --global --add safe.directory '*'

# Git escapes non-ASCII bytes in paths as octal ("\320\277\321\200...") unless told
# otherwise, so a file named привет.txt reaches the web UI unreadable.
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8

# Git-over-HTTPS credentials live in the claude-auth volume so they survive rebuilds;
# the file is written via the web UI (System → Git credentials)
git config --global credential.helper 'store --file /home/claude/.claude/.git-credentials'

# Claude Code hooks: report "waiting for input" / "finished" events so the web UI
# can notify the user. Created only once — the settings file lives in the volume,
# so manual edits are preserved.
SETTINGS=/home/claude/.claude/settings.json
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

echo "Claude Code container ready"
echo "Projects are in /workspace"
echo "Run: claude"
tail -f /dev/null
