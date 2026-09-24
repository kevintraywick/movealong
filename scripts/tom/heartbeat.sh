#!/bin/bash
# Tom's heartbeat (2026-09-24). launchd runs this every 30 minutes
# (com.moveit.heartbeat, installed by install-heartbeat.sh). It starts Claude
# Code headless and has it follow the MoveIt server's heartbeat_recipe: carry
# out the mail actions queued on the board, repost unread mail, refresh the
# calendar band.
#
# Tools are an allow-list: the MoveIt server, Gmail reads plus the writes
# the recipe uses (trash, unlabel, spam, and reply drafts — never sending),
# and Calendar reads. Anything
# else — sending mail, touching events, files, shell — is denied, because a
# headless run has nobody to ask.
#
#   scripts/tom/heartbeat.sh           run now (skips quiet hours)
#   scripts/tom/heartbeat.sh --force   run now, quiet hours or not

set -u
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
# An empty working folder, not the repo: in the repo every run would load the
# project CLAUDE.md (a lot of tokens, twice an hour) and its settings file.
WORK="$HOME/Library/Application Support/MoveIt/heartbeat"
LOG="$HOME/Library/Logs/moveit-heartbeat.log"
ERR="$HOME/Library/Logs/moveit-heartbeat.stderr.log"
LOCK="${TMPDIR:-/tmp}/moveit-heartbeat.lock"
QUIET_START=23   # no runs from 11pm…
QUIET_END=6      # …to 6am, local time

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "$(stamp) $*" >> "$LOG"; }

hour=$((10#$(date +%H)))
if [ "${1:-}" != "--force" ] && { [ "$hour" -ge "$QUIET_START" ] || [ "$hour" -lt "$QUIET_END" ]; }; then
  exit 0
fi

# One run at a time. A lock older than 25 minutes is a run that died.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +25 2>/dev/null)" ]; then
    rm -rf "$LOCK"; mkdir "$LOCK" || exit 0
  else
    log "skip: previous run still going"; exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT

ALLOWED=(
  "mcp__movealong"
  "mcp__claude_ai_Gmail__search_threads"
  "mcp__claude_ai_Gmail__get_thread"
  "mcp__claude_ai_Gmail__trash_thread"
  "mcp__claude_ai_Gmail__unlabel_thread"
  "mcp__claude_ai_Gmail__mark_thread_spam"
  "mcp__claude_ai_Gmail__list_drafts"
  "mcp__claude_ai_Gmail__create_draft"
  "mcp__claude_ai_Google_Calendar__list_calendars"
  "mcp__claude_ai_Google_Calendar__list_events"
)

log "start"
mkdir -p "$WORK" && cd "$WORK" || exit 1
out=$("$CLAUDE" -p "Call the movealong tool heartbeat_recipe and follow it exactly." \
  --model sonnet \
  --allowedTools "${ALLOWED[@]}" \
  --no-session-persistence \
  --output-format text 2>>"$ERR")
code=$?
# The reply is one summary line; keep the tail in case it rambled or failed.
log "done ($code): $(printf '%s' "$out" | tail -n 5 | tr '\n' ' ' | cut -c1-600)"
exit $code
