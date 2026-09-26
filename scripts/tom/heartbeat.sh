#!/bin/bash
# Tom's heartbeat (2026-09-24). launchd runs this every minute
# (com.moveit.heartbeat, installed by install-heartbeat.sh), and most ticks do
# nothing. Every 30 minutes it starts Claude Code headless and has it follow
# the MoveIt server's heartbeat_recipe: carry out the mail actions queued on
# the board, repost unread mail, refresh the calendar. In between, it asks the
# board one cheap question — did a reload ask for a mail check? (2026-09-26) —
# and if so runs the mail-only pass, at most once every 5 minutes.
#
# Tools are an allow-list: the MoveIt server, Gmail reads plus the writes
# the recipe uses (trash, unlabel, spam, and reply drafts — never sending),
# and Calendar reads. Anything
# else — sending mail, touching events, files, shell — is denied, because a
# headless run has nobody to ask.
#
#   scripts/tom/heartbeat.sh           a tick: full run if one is due, else a mail check if asked
#   scripts/tom/heartbeat.sh --force   full run now, quiet hours or not
#   scripts/tom/heartbeat.sh --mail    mail-only run now

set -u
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
# An empty working folder, not the repo: in the repo every run would load the
# project CLAUDE.md (a lot of tokens, twice an hour) and its settings file.
WORK="$HOME/Library/Application Support/MoveIt/heartbeat"
LOG="$HOME/Library/Logs/moveit-heartbeat.log"
ERR="$HOME/Library/Logs/moveit-heartbeat.stderr.log"
LOCK="${TMPDIR:-/tmp}/moveit-heartbeat.lock"
QUIET_START=23   # no full runs from 11pm…
QUIET_END=6      # …to 6am, local time
FULL_EVERY=29    # minutes between full runs (launchd ticks are a minute apart)
MAIL_EVERY=5     # minutes between mail-only runs, however often the board asks

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "$(stamp) $*" >> "$LOG"; }

mkdir -p "$WORK" || exit 1
FULL_STAMP="$WORK/.last-full"
MAIL_STAMP="$WORK/.last-mail"
# True when the stamp file is missing or older than N minutes.
older() { [ ! -e "$1" ] || [ -n "$(find "$1" -mmin +"$2" 2>/dev/null)" ]; }

# Did a reload of the board ask for mail? One GET, no Claude. The board's
# address and key are the ones the MoveIt server is registered with.
mail_wanted() {
  local env url team user key
  env=$(node -e '
    const e = (JSON.parse(require("fs").readFileSync(process.env.HOME + "/.claude.json", "utf8")).mcpServers || {}).movealong?.env || {};
    console.log([e.MOVEALONG_URL, e.MOVEALONG_TEAM, e.MOVEALONG_USER, e.MOVEALONG_AI_KEY || "-"].join(" "));' 2>/dev/null) || return 1
  read -r url team user key <<< "$env"
  [ -n "$url" ] && [ -n "$team" ] && [ -n "$user" ] || return 1
  curl -fsS --max-time 10 -H "x-ai-key: $key" "$url/api/companies/$team/users/$user/inbox/check" 2>/dev/null | grep -q '"wanted":true'
}

hour=$((10#$(date +%H)))
quiet=0
{ [ "$hour" -ge "$QUIET_START" ] || [ "$hour" -lt "$QUIET_END" ]; } && quiet=1

case "${1:-}" in
  --force) mode=all ;;
  --mail)  mode=mail ;;
  *)
    if [ "$quiet" = 0 ] && older "$FULL_STAMP" "$FULL_EVERY"; then mode=all
    # A reload in quiet hours still counts: someone is at the board.
    elif older "$MAIL_STAMP" "$MAIL_EVERY" && mail_wanted; then mode=mail
    else exit 0
    fi ;;
esac

# One run at a time. A lock older than 25 minutes is a run that died.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +25 2>/dev/null)" ]; then
    rm -rf "$LOCK"; mkdir "$LOCK" || exit 0
  else
    # A mail check that lands mid-run is answered by that run's post.
    [ "$mode" = all ] && log "skip: previous run still going"
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT
# Stamp before running, so a run that fails isn't retried every minute.
touch "$MAIL_STAMP"
[ "$mode" = all ] && touch "$FULL_STAMP"

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

if [ "$mode" = mail ]; then
  prompt='Call the movealong tool heartbeat_recipe with part "mail" and follow it exactly.'
else
  prompt="Call the movealong tool heartbeat_recipe and follow it exactly."
fi
log "start ($mode)"
cd "$WORK" || exit 1
out=$("$CLAUDE" -p "$prompt" \
  --model sonnet \
  --allowedTools "${ALLOWED[@]}" \
  --no-session-persistence \
  --output-format text 2>>"$ERR")
code=$?
# The reply is one summary line; keep the tail in case it rambled or failed.
log "done ($code): $(printf '%s' "$out" | tail -n 5 | tr '\n' ' ' | cut -c1-600)"
exit $code
