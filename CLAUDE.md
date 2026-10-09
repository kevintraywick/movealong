# Move Along (product name: MoveIt since 2026-09-13)

A task management app that moves ideas into action and reduces decision-fatigue: a task or subtask can be postponed (moved), completed, or assigned to a human or AI agent in one click.

1. **Move ideas into action** — adding a task makes Claude fill a subtask pane with up to 7 specific, actionable steps (never PM filler).
2. **Reduce decision-fatigue** — every step has a default assignee (🧠 AI / 👩 human), one click to assign. Agents research, price and return actionable information.

Focus is the single-user + AI-agent loop; cross-user collaboration is back-burnered. The basic unit is a **board** (project): a 30-day calendar of day cards, many boards per user.

## Feature docs — read the one you're touching first

Detailed decisions, gotchas and history live in `reference/features/`. **Before working on a feature, read its file; when you learn something about it, write it there, not here.** Only cross-cutting rules belong in this file.

| File | Covers |
|---|---|
| `subtask-pane.md` | the pane under a task: rows, rail, seven-step cap, ↺ top-up, ↑ promote, v2 decision points |
| `ai-drafting-and-research.md` | ai.js, step quality, Opus draft / Sonnet research, 🔎 switch, per-board budget, step cost chips, 🧠 switch |
| `assignment-and-team.md` | assign / accept / return, review rows, handoff chips, Tessa, shared boards, demo team |
| `brief-and-learning.md` | /brief, `briefFor()`, learned lists, `step_events`, how-you-work lines, holdout drafts |
| `mcp-and-tom.md` | the MoveIt server (server/mcp, `/mcp/:secret`), Tom and his skills |
| `lists.md` | "list …" tasks, the pink list box/pane, /lists, shelve / unshelve / sync-master |
| `notes-and-task-pages.md` | /notes, `send_note`, /task/:id |
| `board-rows.md` | lock & deadlines, series, day counter, manual order, → moves, Shift+Click edit, goal (`g`), repeat (`r`), links |
| `board-views.md` | completed board, preferences page, phone portrait layout, List (master) view |
| `dashboard-and-health.md` | /dashboard, completions + pushed bars, health pane, chart palette rule |
| `briefing-and-goals.md` | morning briefing (weather, market, Tom's items), /goals, sprint check-in, Friday review |
| `mail-strip.md` | #mailStrip, inbox tools, per-sender learning, Tom's heartbeat |
| `calendar.md` | calendar.js, feed + connector sync, the event band |
| `ui-chrome.md` | header, switches, favicon, wordmark, dark mode, focus mode, chain hint |
| `help-page.md` | help.html vignettes, margin notes, docs/animation |
| `testing-recipes.md` | throwaway servers, jsdom E2E, qlmanage renders, AI stubs, migration and timezone tests |

Also: `reference/api-reference.md` (routes), `reference/data-model.md` (schema), `reference/roadmap.md`. Check those before re-deriving.

## Project Structure

```
server/public/index.html     - Single-page frontend (vanilla JS); lists/goals/notes/help/task/brief/dashboard/preferences .html are one static file each; nav.js is the header notes, dashboard, goals and lists share
server/src/server.js         - Express API server
server/src/db.js             - SQLite layer (sql.js, pure JS)
server/src/ai.js             - Anthropic API client; drafts and researches subtasks
server/src/calendar.js       - iCal feed fetch/parse/filter + reconciliation into calendar tasks
server/mcp/                  - The board as an MCP server (own package; talks to REST, never the DB)
server/movealong.db          - SQLite file (gitignored)
scripts/tom/                 - Tom's Mac-side scripts (own package; real client files gitignored)
.claude/skills/              - Project skills Tom follows; checked in
docs/animation/, docs/favicon/, docs/commercial/ - generated help vignettes, favicon builder, the :60 commercial
reference/                   - API, schema, roadmap, brainstorms, features/
archive/                     - Old prototypes and mockups (gitignored)
```

`create_monster_cards.py` / `create_monster_cards_pdf` in the root are from another project — ignore them.

## Running, env, stack

`cd server && npm install && npm start` (or `npm run dev` for `node --watch`) → `http://localhost:3000`. Backend changes need a restart under `npm start`.

- `ANTHROPIC_API_KEY` — optional; without it you get mock subtasks. `ai.js` is `require()`d lazily inside the handlers, which fall back to mocks.
- `DB_PATH` (default `./movealong.db`), `PORT` (default 3000).
- `AI_ACCESS_KEY` — when set, only requests with a matching `x-ai-key` get real AI. Set on public deployments.
- `AI_LIMIT_PER_IP_HOUR` (20) / `AI_LIMIT_GLOBAL_DAY` (200) — over-cap gets mocks.
- Stack: Node, Express, sql.js; vanilla JS/HTML/CSS, no build step. Dependencies: express, cors, sql.js, node-ical, `@modelcontextprotocol/sdk`, zod.
- **No test suite, no linter** — verify headlessly with the recipes in `reference/features/testing-recipes.md`. Of build step, framework, tests and linter, only tests would earn their keep.

## Architecture

- All frontend state loads from the API; no local persistence beyond per-browser conveniences in `localStorage['movealong.*']`.
- **No `assigned_to` column; assignment is not a flag.** `POST /tasks/:id/assign` rewrites `owner_id` — the row *moves*. Adding `assigned_to IS NULL` is a 500. `task.assigned_to_id` is a client-side optimistic field only.
- Companies use subdomain-style URLs (`{subdomain}.movealong.com/{user_slug}` is aspirational). No per-user authentication — a known team + user name is the credential (`POST /api/companies` signs in *or* up). **Site login (2026-10-09):** set `SITE_USER` + `SITE_PASSWORD` and the whole site asks for HTTP Basic auth (middleware in `server.js`); unset = open, so local runs and tests are unchanged. Exempt: `/help` + icons, `/mcp/<secret>`, a valid `x-ai-key` (= `AI_ACCESS_KEY`; Tom's scripts send it), and loopback calls with no `X-Forwarded-For`. 10 bad tries per address per 10 min = 429.
- API: all under `/api`, RESTful JSON — full list in `reference/api-reference.md`.
- **The DB persists once per HTTP request** (`flushDb` on response finish, plus SIGTERM/SIGINT) via atomic tmp-file + rename in `saveDb()`. **Anything that writes after the response (research, calendar sync) must call `flushDb()` itself.**
- **Hand-listed task SELECTs are a recurring trap.** Several routes list columns instead of `t.*`; a new task column the board or List view needs (`t.locked`, `t.goal`, `t.list_master_id` …) must be added to each, and **every board query must carry `COALESCE(shelved,0) = 0`**. Grep for the existing ones before adding a column.

## Deployment

- **GitHub** kevintraywick/movealong, `main`. **Railway** auto-deploys on push to `main`.
- **Railway starts `node src/server.js` directly (`server/railway.json`), never `npm start`** — npm turned deploy SIGTERMs into "Deployment crashed" emails on every push.
- **`engines.node` picks the MINIMUM the range allows** — `">=18"` got Node 18 and a crash loop (`node-ical` needs Node 20+). Now `">=22"`; bump it whenever a dependency raises its floor. `require('./calendar')` is wrapped in try/catch with a no-op stub.
- `railway logs --deployment <id>` before guessing about a crash.
- Railway env: `ANTHROPIC_API_KEY` + `AI_ACCESS_KEY` (+ `SITE_USER` / `SITE_PASSWORD` for the site login); volume at `/data` with `DB_PATH=/data/movealong.db`, or every deploy wipes data.
- Domain: `https://moveit.kevintraywick.com` (CNAME → `48p6jw91.up.railway.app` + `_railway-verify.moveit` TXT at Hover); `movealong-production.up.railway.app` still serves.

## Cross-cutting design rules

- **Day keys are UTC-anchored labels, but *which* label is today is local.** `YYYY-MM-DD` arithmetic (`addDays`, `addMonths`, `generateDays`) stays UTC. Frontend today = `getTodayKey()` (`toLocaleDateString('en-CA')`). **Every server "today" goes through `todayKeyFor(req)`** (the `x-tz` header `api()` sends on every call; UTC fallback), or `todayKeyForUser()` for callers with no header. `monthKey()` for the AI budget is still UTC on purpose.
- Incomplete past tasks **spill forward to today** — except locked tasks and calendar rows.
- **Day capacity is 7** pending tasks per (owner, project, day). A task typed onto a full day lands and **bumps** one (`bumpableTaskOn()`); promote and `spawnNextRepeat` overflow via `findDayWithCapacity()`; assign, return, move and lock are uncapped. Details in `board-rows.md`.
- Day cards are **200px**. The subtask pane hangs absolutely below its day column, never wider than it. **The board clips vertically**: `fitExpandedPane()` measures the open pane and sets `padding-bottom` — **any new absolutely-positioned board child must be reserved for there.**
- **Single-pane rule:** one subtask pane at a time. Every site adding to `expandedTaskIds` must `clear()` first.
- **Colour:** accent is a sky-blue ramp (`#38bdf8` / `#0ea5e9` / `#0284c7`, tints `#f0f9ff` / `#bae6fd`). **Never green** (the help page's margin notes are the one exception). **Red `#ef4444` is reserved for warning/overdue.** **Grey is reserved for finished** — sent or waiting work is never greyed.
- **One type scale, 13px base** (~11–15px); only the wordmark differs.
- **Every `title` in `index.html` is footer copy** — the tip bar (`#tipBar`) shows the hovered element's title. Write it as a sentence. A gesture with no control gets an `IDLE_TIPS` entry.
- **Dark mode:** one `body.dark` block at the end of the stylesheet; any new light-background component needs an override that **out-specifies** what it overrides (match the compound selector).
- **No hidden affordances** on anything but one-line board rows; state must be visible.

## Conventions

- Keep the frontend as a single `public/index.html`; new pages are one static file each.
- **Escape all user-controlled text at render time** — `escapeHtml()` (or `linkifyText()` for descriptions), attributes included.
- **Schema migrations:** `ensureColumn(table, col, def)` in `db.js` and add the column to `CREATE TABLE`. **The schema is one SQL template literal — a backtick in a `--` comment ends it**; run `node --check src/db.js` after touching it. `node --check src/server.js` is the server syntax check (`node -e "require(...)"` boots a server).
- **Foreign keys:** `saveDb()` reapplies `PRAGMA foreign_keys = ON` after every `db.export()` (which resets it). If cascades stop working, check this first.
- **One popup box for everything** (`.team-popup` + `.lock-popup-menu` / `.lock-opt`). A new menu adds its id to `hidePopups()` and its trigger to `hidePopupsOnClickOutside()`.
- **Native form controls** ignore dark colours until `appearance: none`; then use `background-color`, not the `background` shorthand.
- **Reuse an existing idiom before inventing a primitive** (hover-reveal icon, hover + key, click-to-popup), and **reuse a control's classes**, not just its shape — then re-read every capture-phase and document-level listener the container falls under (`tryInlineEdit()` bit the list box).
- **UI exploration:** numbered static mockups in `archive/` (gitignored), one file per variant; Kevin picks, then build. When the constraint is width, one variant must spend it on the other axis. Don't prototype inside `index.html`.
- **Safari:** `dragstart` must `setData('text/plain', …)`; `focus()` inside a `visibility: hidden` subtree is ignored (defer 50ms).
- **A failed doc patch must not let the code commit through** — chain `python3 … && git add -A && git commit`, or check `git diff --stat` first.
- Shell: kill test servers with `lsof -ti :PORT | xargs kill`, never `pkill -f`; don't name a zsh variable `UID`; BSD `sed` has no `L,+Np`; the Bash tool's cwd can reset, so use absolute paths.
