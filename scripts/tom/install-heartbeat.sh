#!/bin/bash
# Installs (or reinstalls) Tom's heartbeat as a launchd agent: heartbeat.sh
# every 30 minutes while you're logged in. Runs missed while the Mac slept
# are not made up — the next tick simply does the work.
#
#   scripts/tom/install-heartbeat.sh             install and start
#   scripts/tom/install-heartbeat.sh --uninstall stop and remove
set -eu
LABEL=com.moveit.heartbeat
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/heartbeat.sh"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST"; echo "Heartbeat removed."; exit 0
fi

chmod +x "$SCRIPT"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>StartInterval</key><integer>1800</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/moveit-heartbeat.launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/moveit-heartbeat.launchd.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Heartbeat installed: every 30 minutes, quiet 11pm–6am. Log: ~/Library/Logs/moveit-heartbeat.log"
