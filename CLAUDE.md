# Move Along

A task management app that moves ideas into action and reduces decision-fatigue. It does this by letting users immediately postpone (move) a task or subtask, mark it complete, or assign it to a human or AI agent.

## Vision

Two goals:
1. **Move ideas into action** — When a task is added, Claude immediately populates a subtask pane with the steps needed to complete it, so the user instantly sees what's involved.
2. **Reduce decision-fatigue** — Every subtask has a default assignee (AI or human), and the user can assign with a single click. AI agents research options, fetch prices, check weather, and return actionable information so the user doesn't have to.

Tasks can also be sent to an AI agent for execution, not just humans. Cross-user collaboration (assigning to other people) is currently back-burnered — focus is on the single-user + AI-agent loop.

## Core Concepts

### Projects
The basic unit is a **project page** (the 30-day calendar board). A user can create as many projects as they want using the same username — e.g., "personal", "doghouse", "financial". Each project is its own board.

### Tasks and Subtasks
- When a task is added to a day, a **subtask pane** opens beneath the day pane.
- Claude populates the subtask pane with up to **10 subtasks** — the steps needed to complete the task.
- After the initial subtasks are shown to the user, Claude runs a deeper analysis using agents to review proposed solutions, fetch relevant data (Amazon prices for purchases, weather for outdoor/travel tasks, etc.), and refines the subtasks into a solid plan.
- Each subtask has an **emoji indicating the default assignee**: brain (🧠) for AI agent, woman (👩) for human. The user assigns by clicking the emoji.
- **Dependent subtasks** appear indented (3 spaces) under their parent in light grey font. They move with the parent if assigned.

### Subtask Quality: Actionable, Not Generic
Subtasks must be **specific, actionable, and research-backed** — never vague project-management filler.

**Bad subtasks** (too generic):
- "Define requirements and scope"
- "Research materials and tools needed"
- "Create a detailed plan"

**Good subtasks** (actionable, with research):
- "Pick a location — sunny, 5-10 ft high, near trees (birdsonly.com/placement-guide)"
- "Choose target birds for your area (audubon.org/native-plants/98101)"
- "Decide: buy plans online ($5-15 on Etsy) vs design your own"
- "Get materials — cedar boards, screws, waterproof glue (Home Depot list)"

**Principles:**
1. **Prefix with a mini-label** when helpful: "Project plan:", "Decision:", "Research:", etc.
2. **Include links** — AI subtasks should link to real, relevant websites (retailer searches, guides, location-aware resources) so the user can click and act immediately.
3. **Surface the actual decisions** — don't say "plan the menu"; say "Decide: cook vs cater vs potluck (Thumbtack caterers near you)".
4. **Be domain-specific** — a birdhouse task should mention bird species and wood types, not generic "gather materials".
5. **AI-assigned subtasks do research** — when an AI agent runs a subtask, it should return concrete options, prices, links, and comparisons — not summaries.

### Assignment Flow
- Clicking the assignee emoji on a subtask assigns it (replaces the old Cmd+Click flow).
- Once a task is assigned, it is removed from the sender's day pane and project page.
- A person assigned to a project gets a project page pre-filled with the project name if they aren't already on the project.
- Any assignee may return a task, which reappears on the sender's board on the current day.

### Locking tasks to a date (deadlines)
- A task can be **locked** to a date (a deadline that forces overdue work back to the present). Backed by the `tasks.locked` column; the lock date is just the task's `scheduled_date` while locked.
- **Lock gestures:** Shift+Option+Click the task body quick-locks it to its current day (with confirm); the 📅 icon on each pending task opens a popup to lock-to-this-day, pick a future date, or unlock. A locked task shows 🔒 and an amber left edge.
- Locked tasks are **exempt from auto-spillover**. A past-due locked task **pulls the calendar's first visible day back to its lock date** (anchor = min(today, earliest locked-incomplete date)); "today" stays highlighted by real date, and other overdue tasks still spill to today.
- Moving a locked task forward (the → arrow) asks for confirmation; the lock follows to the new day. Assigning or returning a task clears the lock.

### Day counter (days pushed forward)
- Each task stores `origin_date` — the day it was first **requested** for (capacity overflow counts as a push: origin = requested day, not the effective overflow day). It **never changes**: spillover, → moves, assign, and return all preserve it. Any new code that writes `scheduled_date` must leave `origin_date` alone.
- The day board shows a small light-grey **inclusive** day count after the task text (added Monday → "5" on Friday): days from origin to `max(scheduled_date, today)` + 1, hidden when it would read 1 (the origin day). Rendered by `renderDayCounter()` in `index.html`; **day board only** — not the Main/master page.
- Overdue **locked** tasks keep counting to today (they don't spill, but their age still climbs daily). **Completed** tasks freeze at the day they were completed.
- Tasks created before the migration backfill `origin_date = scheduled_date` on boot (their earlier push history was never recorded).

### Master Project Page
- Each username has a **master project page** that lists all their projects. (The UI button for it is labeled **"Main"**; internally the view mode and API route are still `master`.)
- Tasks are grouped by project (not by day) on this page.
- If a user has 3 projects (e.g., "plan bday party", "build house", "prepare quarterly financials"), the master page shows 3 panes with all open, unassigned tasks for each project.
- When a task is entered into any project, it is appended to the corresponding pane on the master page.
- Assigned tasks are removed from both the day pane and the master project page.

## Project Structure

```
server/public/index.html     - Single-page frontend (vanilla JS, dark theme)
server/src/server.js         - Express API server
server/src/db.js             - SQLite database layer (sql.js, pure JS)
server/src/ai.js             - Anthropic API client; generates subtasks from a task description
server/movealong.db          - SQLite database file (gitignored)
server/package.json          - Backend deps + scripts (`start`, `dev`)
reference/api-reference.md   - HTTP endpoint reference
reference/data-model.md      - SQLite schema (companies, users, tasks, indexes)
reference/roadmap.md         - Done / Next checklist
.claude/                     - Editor launch config + local settings; not shipped
archive/                     - Old prototypes and mockups (gitignored)
```

Unrelated files in the repo root (`create_monster_cards.py`, `create_monster_cards_pdf`) are leftovers from another project — ignore them for MoveAlong work.

## Running Locally

First-time setup:

```bash
cd server
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional — without it you get mock subtasks, not AI ones
npm start                             # or: npm run dev  (uses node --watch for auto-restart)
```

Server starts on `http://localhost:3000`, serves both the API and frontend.

## Environment Variables

- `ANTHROPIC_API_KEY` — **optional** for local dev. Used for AI subtask generation (`claude-sonnet-5`). `server/src/ai.js` throws if it's `require()`d without a key, but it's only required lazily inside the generate-subtasks handler, which catches the error and falls back to `generateMockSubtasks`. The server boots fine without it (or with a dummy value) — you just get mock subtask lists. (Railway still sets it for real AI output.)
- `DB_PATH` — optional. Override default `./movealong.db` location.
- `PORT` — optional. Defaults to 3000.

## Testing

No test suite yet. No linter configured. Manual testing via `http://localhost:3000`.

## Tech Stack

- **Backend:** Node.js, Express, sql.js (SQLite)
- **Frontend:** Vanilla JS/HTML/CSS, single file, no build step
- **Dependencies:** express, cors, sql.js (that's it)

## Architecture

- All frontend state loads from API on signup, no local persistence
- Tasks have an owner (whose board they're on) and optional assigned_by (who gave it)
- Companies use subdomain-based URLs: `{subdomain}.movealong.com/{user_slug}`
- Database auto-creates on first run, saves after every write

## API Pattern

All endpoints under `/api`. RESTful. JSON in/out.
- Companies: `POST /api/companies`, `GET /api/companies/:subdomain`
- Users: `GET|POST /api/companies/:subdomain/users`
- Tasks: `GET|POST /api/companies/:subdomain/users/:slug/tasks`
- Task actions: `PUT /api/tasks/:id`, `POST /api/tasks/:id/assign`, `POST /api/tasks/:id/return`, `DELETE /api/tasks/:id`

Full endpoint reference lives in `reference/api-reference.md`. Schema lives in `reference/data-model.md`. Check those before re-deriving from code.

## Deployment

- **GitHub:** [kevintraywick/movealong](https://github.com/kevintraywick/movealong), default branch `main`. No PR/commit conventions formalized yet.
- **Railway:** Auto-deploy on push to `main`. Build/start uses `npm start` (which runs `node src/server.js` from `server/`).
- **Env vars in Railway:** set `ANTHROPIC_API_KEY` for real AI subtask generation. It is **not** required to boot — without it the server runs and falls back to mock subtasks (see Environment Variables). No other env vars configured yet.
- **Database persistence:** No volume attached. `server/movealong.db` lives on the ephemeral container filesystem, so every deploy wipes all data. Attach a Railway volume (e.g. mount at `/data`) and set `DB_PATH=/data/movealong.db` before this is usable for real users.
- **Custom domain:** Not configured. The `*.movealong.com` subdomain pattern in the code is aspirational until DNS + a proxy are set up.

## Key Design Decisions

- No authentication yet (URL-based access, auth is a planned next step)
- Frontend is a single HTML file with inline CSS and JS
- sql.js chosen to avoid native compilation issues
- 30-day calendar view with horizontal scroll
- Incomplete past tasks spill over to today automatically — **except locked tasks**, which stay pinned to their date
- Calendar day cells are **UTC-based** (`day.key` via `toISOString`), built by `generateDays(anchorKey)`; keep any date math UTC-consistent with `getTodayKey()` and the backend spillover
- Day cards are **200px** wide (shrunk from 400px). The subtask pane hangs absolutely below its day column at `width: 100%` — **never wider than the day it's attached to**
- Subtask pane: a single contained card listing up to 10 steps (AI + user-added together) as compact rows — check, assignee emoji, description, send-arrow on AI steps. Not one-card-per-subtask. Dependent subtasks indented under parents
- **Single-pane rule:** only one subtask pane may be open at a time. Every site that adds to `expandedTaskIds` must `clear()` it first (board + master click handlers, both auto-expand-on-add paths). Same-day board panes are absolutely positioned at identical coordinates, so two open at once silently occlude each other — this was a real bug
- Accent color is a **sky-blue ramp** (`#38bdf8` bright / `#0ea5e9` fills / `#0284c7` dark hover), tints `#f0f9ff`/`#bae6fd`. Replaced the old emerald green — use blue for any new UI, not green
- AI agents do research and analysis after initial subtask generation so user gets immediate feedback first
- Day capacity: max 10 pending tasks per (owner, project) per day. New tasks created on a saturated day overflow to the next day with capacity (creation-only; assign/return/move are not capped)
- **AI assistant master switch** (🧠 toggle, `localStorage` `movealong.assistant`, default on): when on, adding a task auto-generates subtasks and opens the pane; when off, the task is created bare with no AI call
  - **Known gap:** the toggle only gates `addTask`/`addTaskFromMaster` (task creation). Expanding an existing task's row just re-reads stored subtasks (`GET /tasks/:id/subtasks`, no AI call either way). But the ↺ "Regenerate steps" button (`regenerateSubtasks()`) calls `POST /tasks/:id/generate-subtasks` unconditionally — it ignores the toggle. Fix both call sites together if closing this gap.

## Conventions

- Keep the frontend as a single `public/index.html` file
- Backend changes require a restart under `npm start`. Use `npm run dev` (node `--watch`) if you want auto-restart during development.
- Database file is gitignored; it recreates on first run
- When editing the frontend, test via `http://localhost:3000` not `file://`
- New colors: use the sky-blue accent ramp above — do not introduce green
- **Schema migrations:** sql.js has no `ADD COLUMN IF NOT EXISTS`. Add columns via `ensureColumn(table, col, def)` in `db.js` (checks `PRAGMA table_info`), and add the column to the `CREATE TABLE` too. Runs on every boot; safe to leave in.
- **Foreign key cascades:** `db.js` sets `PRAGMA foreign_keys = ON` so the `ON DELETE CASCADE`/`SET NULL` clauses in the schema actually fire (sql.js defaults it off like stock SQLite). Gotcha: `db.export()` — called by `saveDb()` on every write — silently resets this pragma back off, so `saveDb()` reapplies it after every export. If cascades ever stop working again, this is the first thing to check.
- **Local API testing:** boot a throwaway instance with `DB_PATH=<tmp> PORT=<free> ANTHROPIC_API_KEY=dummy node src/server.js` and curl the endpoints. Port 3000 is often taken by another local app — pick a free port. The frontend calls the API at a relative `/api`, so open it on whatever port serves `index.html`.
- **Quick frontend syntax check** (no browser): extract the inline `<script>` and run it through `vm.Script` in Node to catch broken template literals before shipping.
- **Headless frontend E2E** (proven pattern): `jsdom`'s `JSDOM.fromURL` against a throwaway server instance, with `runScripts: 'dangerously'`. Two gotchas: jsdom has no `window.fetch` — bridge it to Node's fetch resolving relative URLs; and use a unique company name per run (the subdomain UNIQUE constraint collides on a reused test DB).
- zsh gotcha: don't name a shell variable `UID` in test scripts — it's read-only and the assignment errors out.
