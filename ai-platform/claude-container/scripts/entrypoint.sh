#!/bin/bash

# The container starts as root only long enough to fix up the named volumes, then
# drops to `claude` for good. Docker creates a fresh volume owned by root:root, and
# claude-auth / opencode-* / codex-home all mount under /home/claude, so without this the agent
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

# Screenshots live outside /workspace, so reading one is a path Claude Code asks
# about on every fresh session. Pre-allowing it is what makes "attach a screenshot"
# a single click in the web UI. Merged rather than seeded with the block above:
# the settings file survives rebuilds, so an existing install would never get it.
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const rule = "Read(/screenshots/**)";
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  const permissions = settings.permissions ?? (settings.permissions = {});
  const allow = permissions.allow ?? (permissions.allow = []);
  if (!allow.includes(rule)) {
    allow.push(rule);
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  }
' "$SETTINGS" || echo "warning: could not add the /screenshots read permission to $SETTINGS"

# opencode.json lives in a volume, so the copy baked into the image only ever seeds
# a fresh install: a machine set up before the theme was added would keep its old
# config forever. Whatever the image knows and the volume does not is merged in here
# — additively, so a provider tweaked by hand or a theme picked with /theme survives. (The default theme borrows the terminal's own ANSI colours, and
# against the web terminal's near-black background half of opencode turns unreadable.)
OPENCODE_CONFIG=/home/claude/.config/opencode/opencode.json
node -e '
  const fs = require("fs");
  const path = require("path");
  const [file, skelFile] = process.argv.slice(1);
  let config = {};
  try { config = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  const skel = JSON.parse(fs.readFileSync(skelFile, "utf-8"));

  let changed = false;
  if (!config.theme && skel.theme) { config.theme = skel.theme; changed = true; }
  for (const [name, provider] of Object.entries(skel.provider ?? {})) {
    const providers = config.provider ?? (config.provider = {});
    if (!providers[name]) { providers[name] = provider; changed = true; }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
  }
' "$OPENCODE_CONFIG" /etc/skel-opencode.json || echo "warning: could not update $OPENCODE_CONFIG"

# Gemini CLI stops on an interactive auth/theme picker when it has no settings file.
# Seeds the volume the same way as above.
if [ ! -f /home/claude/.gemini/settings.json ]; then
  mkdir -p /home/claude/.gemini
  cp /etc/skel-gemini-settings.json /home/claude/.gemini/settings.json 2>/dev/null || true
fi

echo "Claude Code container ready"
echo "Projects are in /workspace"
echo "Run: claude"
tail -f /dev/null
