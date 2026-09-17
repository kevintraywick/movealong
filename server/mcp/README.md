# The MoveIt server (MCP)

The board as tools. Any MCP client — Claude Code, Claude Desktop, an Agent SDK
script — can read and write your tasks, steps, task pages and brief, using its
own mail, calendar and files to do the work. The board holds no credentials.

```
cd server/mcp && npm install
```

Register with Claude Code (user scope, so it is available in every project):

```
claude mcp add movealong -s user \
  -e MOVEALONG_URL=https://moveit.kevintraywick.com \
  -e MOVEALONG_TEAM=<team subdomain> \
  -e MOVEALONG_USER=<your slug> \
  -e MOVEALONG_AI_KEY=<the AI access key, if the server sets one> \
  -- node /Users/moon/MoveAlong/server/mcp/index.js
```

Point `MOVEALONG_URL` at `http://localhost:3000` to work against a local server.
`MOVEALONG_TZ` defaults to the machine's zone.

## Over the web — the phone app and remote clients (2026-09-13)

The same tools are mounted inside the board at `https://moveit.kevintraywick.com/mcp/<MCP_SECRET>`
as stateless Streamable HTTP. Set three Railway variables and redeploy:

```
MCP_SECRET=<long random string — openssl rand -hex 24>
MCP_TEAM=kevstuff
MCP_USER=kev
MCP_TZ=America/Chicago
```

Then in the Claude app: **Settings › Connectors › Add custom connector**, paste the URL
(with the secret), no OAuth. "Log 10,000 steps to my MoveIt health dashboard" works from
the phone after that. The secret is the only lock on the door; rotate it by changing the
variable. Without `MCP_SECRET` the endpoint is a 404.

Claude Code on the Mac can point at the same URL instead of the local stdio copy:
`claude mcp add moveit -s user --transport http https://moveit.kevintraywick.com/mcp/<secret>`.

## The morning briefing

Say **"brief me"** (or, in Claude Code, `/mcp__moveit__morning-brief`). The assistant
reads `briefing_recipe`, gathers Gmail, Calendar, the board and the health log, and
calls `post_briefing`. The board opens the result as a pane of tickable rows under
today's card on your first board; the weather line comes from the ZIP on the
preferences page. Unticked rows are replaced by the next morning's briefing.

Texts are Mac-only: `scripts/mac/unread-texts.js` (needs Full Disk Access) feeds the
briefing's text section, and `scripts/mac/text.js "Bob" "Meet me at 7 at Ralph's"`
sends one — Claude Code on the Mac runs both; the MoveIt server can't reach Messages.

## Tools

| tool | does |
|---|---|
| `list_boards` | your boards, tab order, due-today counts |
| `list_tasks` | one board's tasks (pending by default; day window optional) |
| `add_task` | create a task (today by default, overflow honoured); optional background, lock, and AI-drafted steps |
| `update_task` | complete/reopen, move, lock, goal, repeat, rename |
| `get_task` | row + page (background, results, notes) + steps |
| `add_note` | append to the task page's note feed |
| `send_note` / `list_notes` | a free-standing note to the Notes page (`/notes`) — a quote, an idea, a feature request; not attached to any task |
| `set_results` | write the Results (and/or Background) pane |
| `add_step` / `tick_step` / `promote_step` | steps under a task |
| `get_brief` / `append_brief` / `set_contact_field` | the standing notes the assistant reads |
| `completions` | completed per day per board for a month |
| `get_health` | the health log (steps, weight, gym, yoga) for the last N weeks |
| `get_briefing` / `post_briefing` / `tick_briefing_item` | today's briefing rows: read, replace, tick |
| `briefing_recipe` | the steps for assembling the briefing (also the `morning-brief` prompt) |
| `log_health` | record steps / weight / gym / yoga for a day — defaults to yesterday |

## Try it

> Read my board. What's locked to today? Add "confirm insurance for Dr. Okafor"
> on Sep 30, locked, with a note on its page saying which policy.

> Look at task 42 and write up what you found in its Results.
