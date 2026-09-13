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

## Tools

| tool | does |
|---|---|
| `list_boards` | your boards, tab order, due-today counts |
| `list_tasks` | one board's tasks (pending by default; day window optional) |
| `add_task` | create a task (today by default, overflow honoured); optional background, lock, and AI-drafted steps |
| `update_task` | complete/reopen, move, lock, goal, repeat, rename |
| `get_task` | row + page (background, results, notes) + steps |
| `add_note` | append to the task page's note feed |
| `set_results` | write the Results (and/or Background) pane |
| `add_step` / `tick_step` / `promote_step` | steps under a task |
| `get_brief` / `append_brief` / `set_contact_field` | the standing notes the assistant reads |
| `completions` | completed per day per board for a month |
| `get_health` | the health log (steps, weight, gym, yoga) for the last N weeks |
| `log_health` | record steps / weight / gym / yoga for a day — defaults to yesterday |

## Try it

> Read my board. What's locked to today? Add "confirm insurance for Dr. Okafor"
> on Sep 30, locked, with a note on its page saying which policy.

> Look at task 42 and write up what you found in its Results.
