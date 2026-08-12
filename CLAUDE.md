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
- Claude populates the subtask pane with up to **7 subtasks** — the steps needed to complete the task (prompt asks for 5-7; the generate-subtasks endpoint hard-caps AI and mock lists at 7).
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
- **Overdue day panes get a red border.** When the anchor is pulled back, every day before today (`isOverdue: key < todayKey` in `generateDays()`, `.day-card.overdue` class) shows a 2px red (`#ef4444`) border + red header/date, so the first pane clearly reads as "not today"; today keeps its blue treatment. Gotcha: `selectedDayIndex` defaults to `0`, so the anchor-back overdue day is auto-selected — the red border must out-specify `.selected`'s blue border (`.day-card.overdue.selected` rule) while leaving the selection shadow intact.
- Moving a locked task forward (the → arrow) asks for confirmation; the lock follows to the new day. Assigning or returning a task clears the lock.
- **A locked task on its lock day renders its text red** (`.task-item.locked-today`, gated on `!completed && scheduled_date === todayKey`). Red overrides everything else on the row — including a series color/tint.
- **Project tabs never move.** All boards render into a single `#projectTabs` flex row in the user's own order; the active one is styled in place (`.active`). The old two-container split (`#projectTabs` = active, `#projectTabsOther` = the rest) is gone — it made the selected board jump to the front. Consequences that are load-bearing: every tab shares one geometry (3px/10px, 12px), `.due` compensates its 2px border with 2px/9px padding, and **`.active` carries no `font-weight`** — bolding the label widens that tab and nudges the rest of the row on every switch.
- **Deleting a board is per-user.** Clicking the tab you're *already on* opens a board popup (reuses `.team-popup`/`.lock-popup-menu`, same element as the account popup) with **Delete this board** — the click was a no-op before, so deletion costs no new affordance and stays one deliberate step off the main path. `DELETE /api/companies/:sub/users/:slug/projects/:id` drops the caller's `project_members` row and **their own** tasks (+subtasks) on that board; another member's copy is untouched. The `projects` row is destroyed only when the last member leaves. Two load-bearing details: `tasks.project_id` is `ON DELETE SET NULL`, so tasks **must** be deleted explicitly — letting the FK fire orphans them to `project_id = NULL` where no view can reach them and nothing can clean them up. And the route refuses to remove a user's **last** board (409), because zero projects is an empty state the app offers no way out of. No undo.
- **Tab order is per-user and drag-sortable.** `project_members.position` (NULL = never dragged) orders `GET /projects` via `ORDER BY CASE WHEN pm.position IS NULL THEN 1 ELSE 0 END, pm.position, p.created_at`, so the default is creation order and new projects append. `PUT /api/companies/:sub/users/:slug/projects/order` takes `{ project_ids }`, keeps only ids the user belongs to, dedupes, and appends any it wasn't sent — a partial or hostile list can't drop a board. Frontend: `attachProjectTabDrag()` + `reorderProjects()` splice the local array, repaint optimistically, then PUT. Order lives on `project_members`, not `projects`, so one member's arrangement never reorders anyone else's bar.
  - The tab drag and the series drag share the `dragstart`/`drop` events, so each gates on its own state var: tab handlers early-return unless `draggedProjectId` is set, task handlers on `draggedTaskId`. `justDraggedProject` (cleared on a 0ms timeout in `dragend`) swallows the click that can follow a drop on the origin tab, so dragging never switches boards. Desktop only — HTML5 DnD doesn't fire on iOS touch, same as the series drag.
- **Off-screen boards with a deadline flag their tab red.** `GET /projects` returns `due_today` per project (count of the user's `locked = 1 AND completed = 0 AND scheduled_date <= today` tasks — past-due locks count too). `renderProjectBar()` puts `.project-tab.other.due` (2px `#ef4444`, padding trimmed to 2px/9px so the tab doesn't grow) on any non-active tab with `due_today > 0`; the active tab never flags, since you're already looking at it. Counts refresh from inside `loadTasks()` via `refreshProjectDueFlags()`, which merges `due_today` into the existing `projects` array (never replaces it — that would drop the local `currentProject` reference) and repaints the bar. Every lock/complete/move/delete path already awaits `loadTasks()`, so the flag stays live with no extra call sites.
- **On the List (master) view, a locked task's date renders red** (`.project-task-date.locked-date`, bold). The master route SELECT must include `t.locked` for this — it's a hand-listed column list, not `t.*`, so new task flags the List view needs have to be added there explicitly.

### Series (task chains / dependencies)
- **User-facing copy says "next step in a series" — never parent/child.** The schema's `parent_task_id` naming is internal only; parent/child reads as hierarchy (task-contains-subtasks) where a series is a sequence. Help card + margin note were rewritten to step language 2026-08-05.
- **Drag a task onto another task** to make it the next step in a series: it splices in immediately after the drop target and moves to the target's day + 1 (`origin_date` untouched). Backed by `tasks.parent_task_id` (each task points at its predecessor; single successor enforced at link time, so a series is a linear linked list). `POST /api/tasks/:id/link`.
- **Countdown circles:** series members show a small number *inside the existing completion circle* — position-from-end over the whole chain, so the first step shows the series size and the last shows 1 ("steps remaining including this one"). Completing a member splices it out (see below), so the remaining chain renumbers on the next render. Empty circle = free-standing task. Day board only. Chosen over separate dots/badges after mocking 9 variants (`archive/pm-v*.html`).
- **Hover threads:** hovering any series member lights up the whole family (background tint), fades the rest of the board (`.board-container.threading`), and draws thin SVG bezier threads (`#chainOverlay`) between consecutive members across day cards. Hover-only, no pin — click still opens the subtask pane. Colors come from `CHAIN_COLORS` (violet/orange/fuchsia/indigo/cyan — no red, no green) keyed by root task id; color appears **only on hover**, the resting board stays monochrome.
- **Move cascade:** changing a series member's date (→ arrow, lock popup, any `PUT` with `scheduled_date`) shifts every later step by the same delta. The cascade **stops at the first locked step** (deadlines never drift; steps behind a lock compress the gap) and **skips completed steps** without stopping. Earlier steps never move.
- **Spillover cascades too:** an overdue series member spills to today and drags its successors forward by the same delta (same lock-stop rule), so a lagging series re-plans itself while keeping its spacing.
- **Boot chain repair:** `repairCompletedChainLinks()` in `server.js` runs on every boot and splices any completed task that still holds chain links (data from before completing-severs-links; re-fetches each row before splicing so consecutive completed members re-link their pending tail correctly). Idempotent; logs only when it fixes something.
- **Series never break:** assigning, deleting, or **completing** a member splices it out (successor re-links to predecessor) — `spliceOutOfChain()` in `server.js`. Completing severs one-way: reopening the task does NOT restore its links. Re-dropping a chained task repositions it (splice out, then insert). Frontend gotcha: `toggleComplete()` must `loadTasks()` when completing a chained task, because the splice rewrites *other* rows' `parent_task_id` server-side. Consequence: the countdown numbers renumber on completion now (the old "stable when a middle step completes" behavior is gone), and a 2-step chain dissolves entirely when either member completes.
- **Unlink:** hovering a chained task (day board only) reveals a ✂️ next to it whenever the task has a predecessor **and is pending** — the chain ROOT never shows scissors (it has no parent edge to cut); cut a 2-chain from its child. This is a recurring support question, not a bug. Clicking it (with a confirm) cuts just that one edge — `POST /api/tasks/:id/unlink` nulls the task's own `parent_task_id` and leaves its successors attached, so the task becomes the root of a new, separate series. Distinct from `spliceOutOfChain()` (used by assign/delete), which bypasses the task entirely by re-linking its successor straight to its predecessor.
- Frontend: `computeChains()` builds `chainInfo` (task id → chainId/countdown/color) from the loaded task list on every `renderBoard()`. After any date-changing call, the frontend re-fetches the full task list (`loadTasks()`) because cascades change other rows server-side.

### Day counter (days pushed forward)
- Each task stores `origin_date` — the day it was first **requested** for (capacity overflow counts as a push: origin = requested day, not the effective overflow day). It **never changes**: spillover, → moves, assign, and return all preserve it. Any new code that writes `scheduled_date` must leave `origin_date` alone.
- The day board shows a small light-grey **inclusive** day count after the task text (added Monday → "5" on Friday): days from origin to `max(scheduled_date, today)` + 1, hidden when it would read 1 (the origin day). Consequence: **the counter never displays "1"** — its first visible value is 2 (e.g. postponing a task to tomorrow immediately shows 2, both endpoints counted). The help page's postpone vignette shows "2" for exactly this reason. Rendered by `renderDayCounter()` in `index.html`; **day board only** — not the Main/master page. **Counts over 10 render red** (`.task-day-counter.lagging`) so lagging items get attention.
- Overdue **locked** tasks keep counting to today (they don't spill, but their age still climbs daily). **Completed** tasks freeze at the day they were completed.
- Tasks created before the migration backfill `origin_date = scheduled_date` on boot (their earlier push history was never recorded).

### Priority (hover + 1/2/3)
- **Hover a pending task and press `1`, `2`, or `3`** to flag it with that many red `!` marks (3 = most urgent). `0` clears it; pressing the level it already has toggles it off. Backed by `tasks.priority` (0-3, clamped server-side in `PUT /api/tasks/:id`).
- Marks render **inline right after the day counter** (`renderPriorityMarks()`), so three of them cost ~10px and the 200px column never widens. Red `#ef4444` — the sanctioned warning colour.
- **The list re-sorts on `mouseleave`, not on keypress.** The marks paint immediately via direct DOM mutation (`paintPriorityMarks()`), but the row holds its place until the pointer leaves it — sorting instantly would slide the row out from under the cursor and send a follow-up keystroke to its neighbour. `pendingPriorityRow` (declared in APP STATE, cleared at the top of `renderView()`) tracks the row owing a sort.
- Sorting is **highest-first, stable**: `sortByPriority()` on the day board's pending list only (completed/assigned sections below the divider keep their order); `ORDER BY t.priority DESC, ...` on the master route. With every task at 0 the order is identical to pre-feature behaviour.
- **Eligible rows:** pending only. Completed, assigned-away (`.forwarded`) and placeholder rows ignore the keys and never render marks.
- **The keydown branch must stay above the `viewMode !== 'calendar'` guard** (so it works on Main) **and above the type-to-focus fallback** — that fallback would otherwise swallow the digit into the add-task input. It also early-returns when focus is in any `INPUT`/`TEXTAREA`/`SELECT`/contentEditable, so typing "3 eggs" into the add-task box never sets a priority.
- Hover detection reads the live CSS state via `document.querySelector('.task-item:hover, .project-task-item:hover')` — the row that visibly changed colour is exactly the row that gets flagged, with no separate hover tracking to drift out of sync.
- Writes are chained per task id (`priorityWrites` map) so two fast keypresses can't land out of order server-side.
- Priority is **display/ordering only** — it never writes `scheduled_date`, so it triggers no series cascade, no spillover change, and doesn't count against day capacity.

### Hyperlink tasks
- Any URL inside a task's text renders as a clickable link (`.task-link`) that **opens in a new tab** (`target="_blank" rel="noopener noreferrer"`). Day board **and** the Main/master page, plus subtask rows (so AI-generated links are clickable); forwarded/placeholder rows are still plain text.
- `linkifyText()` in `index.html` escapes the whole description first, then wraps matches of `TASK_URL_RE` (`http(s)://…` and `www.…` **only** — so a `javascript:` string can never become an href). Trailing sentence punctuation (`. , ) ] ' "`) is trimmed back out of the link. `www.` forms get an `https://` prefix on the href.
- Task descriptions are therefore **HTML-escaped now** (they used to be injected raw — that was an XSS hole). Typed markup shows literally.
- Links carry `draggable="false"` so dragging from the link body still starts the task's series drag instead of a URL drag.
- Both description click handlers (board + master) early-return on `e.target.closest('a.task-link')`: a link click navigates and does **not** toggle the subtask pane. Clicking any non-link part of the text opens the pane as before.
- **Completing any task closes its subtask pane** (`toggleComplete()` drops it from `expandedTaskIds` on `willComplete`; both views share this handler). Originally this was gated to tasks whose text contained a URL — the gate (and the `taskHasLink()` helper) was removed 2026-08-05. Reopening a completed task leaves the pane closed.

### Quick lists ("list …" tasks)
- A task whose description starts with the word **"list"** (`/^list\b/i` — `isListTask()` frontend, same regex in `server.js` and `ai.js`; `\b` keeps "listen…" out) gets a different subtask pane: the user's **quick list on top, AI "Suggestions" below**.
- **My list**: the user's own items are ordinary subtasks with `assignee_type 'human'`, rendered as plain checkbox rows (no emoji/arrow). Below them, dashed **blank slots** (`.quick-slot`): 3 to start, then always exactly one — `Math.max(3 - count, 1)`. Enter creates the subtask and refocuses the next empty slot (`addQuickListItem()`), so items can be rattled off.
- **Suggestions**: AI-generated rows are forced to `assignee_type 'ai'` server-side and rendered with the standard row anatomy — except the send-arrow slot holds an **↑ "Move to my list"** button (send-to-agent is still a placeholder, so ↑ replaces → there). Clicking ↑ just PUTs `assignee_type: 'human'` — the row moves into My list and survives regeneration.
- **Regenerating a list task deletes only the AI rows** (`DELETE … WHERE assignee_type='ai'`) and the endpoint returns the **full** subtask set (the frontend replaces its cache with the response — returning only created rows would vanish the user's items from the UI).
- `ai.js` `buildPrompt()` branches on the same regex: list tasks ask for **7 concrete candidate items** (real titles/places/products, links where useful) returned as bare JSON strings; the parser accepts strings or `{description}` objects. `generateMockSubtasks` has a matching placeholder branch.
- The row builder is a shared closure `subtaskRow(st, moveUp)` inside `renderSubtaskPane()`. Gotcha that bit once: call it as `pending.map(st => subtaskRow(st))`, never `pending.map(subtaskRow)` — map's index argument lands in `moveUp` and every row after the first grows an ↑.
- History: v1 of this feature (same day) rendered suggestions as a Family Feud board — hidden ranked slats, reveal-on-match, adopt-on-click. Kevin cut the game for the plain split pane within hours. Lesson: playful mechanics layered on a simple feature are the first thing he trims; ship the minimal interaction first.

### Master Project Page
- Each username has a **master project page** that lists all their projects. (The UI button for it is labeled **"List"** — renamed from "Main" 2026-08-05; internally the view mode and API route are still `master`.)
- Tasks are grouped by project (not by day) on this page.
- If a user has 3 projects (e.g., "plan bday party", "build house", "prepare quarterly financials"), the master page shows 3 panes with all open, unassigned tasks for each project.
- When a task is entered into any project, it is appended to the corresponding pane on the master page.
- Assigned tasks are removed from both the day pane and the master project page.

## Project Structure

```
server/public/index.html     - Single-page frontend (vanilla JS, dark theme)
server/public/help.html      - Static help page (served at /help; "?" link in the footer bar)
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
- `AI_ACCESS_KEY` — optional. When set, only requests with a matching `x-ai-key` header get real AI generation; others get mocks. Set on public deployments so strangers can't spend the Anthropic credit.
- `AI_LIMIT_PER_IP_HOUR` (default 20) / `AI_LIMIT_GLOBAL_DAY` (default 200) — rate caps on the generate-subtasks endpoint; over-cap requests get mocks.

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
- Database auto-creates on first run; writes mark it dirty and it persists **once per HTTP request** (`flushDb` on response finish, plus SIGTERM/SIGINT) via an atomic tmp-file + rename in `saveDb()` — not per statement

## API Pattern

All endpoints under `/api`. RESTful. JSON in/out.
- Companies: `POST /api/companies` (**sign in *or* sign up** — an existing team + user name returns that account with `returning: true` instead of 409ing; a known name is the credential, since there's no auth), `GET /api/companies/:subdomain`
- Users: `GET|POST /api/companies/:subdomain/users`
- Tasks: `GET|POST /api/companies/:subdomain/users/:slug/tasks`
- Task actions: `PUT /api/tasks/:id`, `POST /api/tasks/:id/assign`, `POST /api/tasks/:id/return`, `DELETE /api/tasks/:id`

Full endpoint reference lives in `reference/api-reference.md`. Schema lives in `reference/data-model.md`. Check those before re-deriving from code.

## Deployment

- **GitHub:** [kevintraywick/movealong](https://github.com/kevintraywick/movealong), default branch `main`. No PR/commit conventions formalized yet.
- **Railway:** Auto-deploy on push to `main`. Build/start uses `npm start` (which runs `node src/server.js` from `server/`).
- **Env vars in Railway:** set `ANTHROPIC_API_KEY` for real AI subtask generation. It is **not** required to boot — without it the server runs and falls back to mock subtasks (see Environment Variables). **Set `AI_ACCESS_KEY` alongside it** so only the owner's browsers (key entered via Shift+Click on 🧠) trigger billed calls.
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
- Subtask pane: a single contained card listing up to 7 AI steps (plus user-added ones) as compact rows — check, assignee emoji, description, send-arrow on AI steps, ↺ "Regenerate all steps" absolutely positioned top-right. Not one-card-per-subtask. Dependent subtasks indented under parents. **Completed subtasks disappear from the pane** (filtered at render; the server keeps them for the List view's n/m progress count) — there is currently no way to un-check one from the UI. "list …" tasks render the quick-list variant instead (see Quick lists above)
- The → send-to-agent arrow on AI subtask rows is a **placeholder** — it only toasts "Agent dispatched"; real dispatch is unbuilt. That's why list-pane suggestions could repurpose its slot for ↑
- **Single-pane rule:** only one subtask pane may be open at a time. Every site that adds to `expandedTaskIds` must `clear()` it first (board + master click handlers, both auto-expand-on-add paths). Same-day board panes are absolutely positioned at identical coordinates, so two open at once silently occlude each other — this was a real bug
- **One type scale, 13px base.** `body` is 13px and every component sits on ~11/12/13/14/15px (day headers 14, section names 15, labels 11-12). The old split — 22px base with a 13px board inside it — is gone; don't reintroduce outsized text on the Main page, header, or modals. The only exception is the wordmark.
- **Wordmark:** "Move<span>Along</span>" in self-hosted Bricolage Grotesque 800 (`public/fonts/bricolage-grotesque-800.woff2`, ~38 KB, served by the express.static middleware) at 17px — small but heavy, "Along" in accent blue. It is the only non-system type in the app; don't use the display face anywhere else.
- **Quiet single-row header:** 44px min-height, blur/white bar with bottom border, full-bleed via negative margins against `body`'s 20px padding. Everything in the chrome whispers (grey, 12-13px) — nothing outranks a day header. Order: wordmark · +New project (brand-styled: bold dark text, blue `+` — reads as chrome, not board content) · tabs (all projects in user order, active styled in place — `#projectTabs` has no `margin-left: auto`) · Calendar/List segmented toggle (this carries the `margin-left: auto` that splits left/right) · 🧠 switch · theme toggle · user·project chip. The "new board" + button (start-a-fresh-account) was removed 2026-08-05. **Clicking the user·project chip opens an account popup with Sign out** (added 2026-08-11) — it `clearSession()`s and reloads to the signup screen. There is no auth, so this is not a security boundary; it just makes the device forget which account it was showing. Theme and AI key live under their own localStorage keys and survive it. The popup reuses `.team-popup`/`.lock-popup-menu`, right-anchored because the chip sits at the end of the header.
- **Task-row hover is `#f0f9ff`** (sky tint). The original `rgba(255,255,255,.05)` was a dark-theme leftover — invisible on white. Chain-hover tints are inline styles and still override it.
- **Dark mode** (🌙/☀️ header toggle, `localStorage` `movealong.theme`, default light): one `body.dark` override block at the end of the stylesheet — slate palette (bg `#0f172a`, cards `#1e293b`, borders `#334155`, text `#e2e8f0`); accent blue, semantic red, and lock amber survive unchanged. The toggle icon shows the theme you'd switch **to**. Any new component with a light background needs a `body.dark` override added to that block. Chain-hover tints are computed in `drawChainThread()` — pastel in light, translucent rgba of the chain color in dark. `help.html` has its own toggle + `body.dark` block reading the **same** localStorage key, so board and help stay in sync; its demo vignettes intentionally stay light in dark mode (they're miniature screenshots of the light board, framed like media — full dark vignettes would need per-scene keyframe forks).
- **Chain hint chip:** a dashed dismissible whisper ("Drag a task onto another…") renders in today's card when the board has 2+ pending tasks and no series exists (`shouldShowChainHint()`). `localStorage['movealong.hint.chain']` stores a session-appearance count (incremented once per session) — the chip retires after **3 sessions**, on dismiss (`'dismissed'`), or the moment a chain exists.
- Accent color is a **sky-blue ramp** (`#38bdf8` bright / `#0ea5e9` fills / `#0284c7` dark hover), tints `#f0f9ff`/`#bae6fd`. Replaced the old emerald green — use blue for any new UI, not green. **Red (`#ef4444`) is reserved for semantic warning/overdue signals** (e.g. overdue day panes), not decoration — it's the one sanctioned exception to blue-only
- AI agents do research and analysis after initial subtask generation so user gets immediate feedback first
- Day capacity: max 10 pending tasks per (owner, project) per day. New tasks created on a saturated day overflow to the next day with capacity (creation-only; assign/return/move are not capped)
- **AI assistant master switch** (🧠 toggle, `localStorage` `movealong.assistant`, default on): when on, adding a task auto-generates subtasks and opens the pane; when off, the task is created bare with no AI call
  - **Shift+Click the 🧠 toggle** prompts for the **AI access key** (`localStorage` `movealong.aikey`, sent as `x-ai-key` on every `api()` call). When the server sets `AI_ACCESS_KEY`, only requests with the matching header get real AI (`aiKeyAllows()`, timing-safe compare); all others silently get mock subtasks. Unset server-side = open (rate-limited) AI as before. Second layer: per-IP hourly + global daily caps (`AI_LIMIT_PER_IP_HOUR`/`AI_LIMIT_GLOBAL_DAY`).
  - **Known gap:** the toggle only gates `addTask`/`addTaskFromMaster` (task creation). Expanding an existing task's row just re-reads stored subtasks (`GET /tasks/:id/subtasks`, no AI call either way). But the ↺ "Regenerate steps" button (`regenerateSubtasks()`) calls `POST /tasks/:id/generate-subtasks` unconditionally — it ignores the toggle. Fix both call sites together if closing this gap.

## Conventions

- Keep the frontend as a single `public/index.html` file
- Backend changes require a restart under `npm start`. Use `npm run dev` (node `--watch`) if you want auto-restart during development.
- Database file is gitignored; it recreates on first run
- When editing the frontend, test via `http://localhost:3000` not `file://`
- New colors: use the sky-blue accent ramp above — do not introduce green
- **Escape all user-controlled text at render time.** Any `${...}` interpolating a task/subtask description, project name, user name/initials/color, or error message into an HTML template must go through `escapeHtml()` (or `linkifyText()` for description fields, which escapes and then wraps URLs). This includes attribute positions (`placeholder`, `title`, `style`). A headless XSS render test recipe exists (jsdom, seeds hostile payloads via API, asserts inert render) — rerun it when touching render functions.
- **Schema migrations:** sql.js has no `ADD COLUMN IF NOT EXISTS`. Add columns via `ensureColumn(table, col, def)` in `db.js` (checks `PRAGMA table_info`), and add the column to the `CREATE TABLE` too. Runs on every boot; safe to leave in.
- **Foreign key cascades:** `db.js` sets `PRAGMA foreign_keys = ON` so the `ON DELETE CASCADE`/`SET NULL` clauses in the schema actually fire (sql.js defaults it off like stock SQLite). Gotcha: `db.export()` — called by `saveDb()` on every write — silently resets this pragma back off, so `saveDb()` reapplies it after every export. If cascades ever stop working again, this is the first thing to check.
- **Local API testing:** boot a throwaway instance with `DB_PATH=<tmp> PORT=<free> ANTHROPIC_API_KEY=dummy node src/server.js` and curl the endpoints. Port 3000 is often taken by another local app — pick a free port. The frontend calls the API at a relative `/api`, so open it on whatever port serves `index.html`.
- **Quick frontend syntax check** (no browser): extract the inline `<script>` and run it through `vm.Script` in Node to catch broken template literals before shipping.
- **Headless frontend E2E** (proven pattern): `jsdom`'s `JSDOM.fromURL` against a throwaway server instance, with `runScripts: 'dangerously'`. Two gotchas: jsdom has no `window.fetch` — bridge it to Node's fetch resolving relative URLs; and use a unique company name per run (the subdomain UNIQUE constraint collides on a reused test DB).
  - To reach a signed-in board without driving the signup form: seed the API via fetch, set `localStorage['movealong.session'] = JSON.stringify({subdomain, slug, projectId})` (exact keys — `slug`, not `userSlug`; wrong keys fail silently to the signup screen), then call the app's `restoreSession()` and wait for render.
- **HTML5 drag & drop:** `dragstart` must call `e.dataTransfer.setData('text/plain', ...)` or Safari never initiates the drag. `.task-item` already has `user-select: none`, which drag also needs.
- **Safari ignores `focus()` on elements inside a `visibility: hidden` subtree.** The modals fade in via `visibility` + `opacity` transitions, so focusing a field in the same tick as adding `.visible` silently fails — defer it (`setTimeout(() => input.focus(), 50)`, see the New project modal).
- **Help-page vignettes (`help.html`):** feature cards get looping pure-CSS mini-scenes in column 2 of the `three-col` grid, built from a shared vocabulary (`.mini-card`/`.mini-task`/`.mini-circle`/`.mini-day`, real dates via `data-day-offset`, one storyline: building a backyard fence). Section order: The board → **More fun** (Links, Prioritize, Create lists — added 2026-08-05) → Power moves → Subtasks. In the header, the theme toggle sits **right** of "← Back to your board" so the link's arrow doesn't point at it. Hard-won rules:
  - **Never stagger elements in an infinite loop with `animation-delay`** — the delay permanently phase-shifts that element against the scene's shared fade, so it lingers into the next cycle. Give each element its own `@keyframes` with percentage offsets on the same duration (`stepIn1..5`, `clock1..3`).
  - **Pin `opacity` (and any reset property) at every visible keyframe.** A property keyed only in the last few keyframes interpolates from its implicit start value across the ENTIRE cycle — the chain scene's dragged task faded over the whole 8s and was near-invisible by the time it "landed" on Thursday. If a keyframe block ends with `opacity: 0` for the loop reset, earlier frames need explicit `opacity: 1`.
  - **Anchor animated cursors inside their click target** (`top:50%; left:50%`, so `translate(0,0)` = target center; the rest position is an offset in the keyframes). Absolute scene coordinates misaligned twice (prio and done scenes) because font metrics shift row positions a few px.
  - **Red attention ring** = an SVG `<ellipse pathLength="100">` in a `.nav-ring` svg absolutely positioned inside the target, drawn by animating `stroke-dashoffset` (`ringDraw`), tilted a few degrees for a hand-drawn feel. Resize per target with a second class (`.scissors-ring` pattern).
  - Every scene needs `prefers-reduced-motion` end-state overrides in the shared reduce block; scenes intentionally stay light in dark mode (see Dark mode above).
- **Margin notes (help page, column 3):** `.margin-note` = hand-drawn SVG arrow + handwriting font stack (`Bradley Hand`/`Segoe Print`/`Comic Sans MS`/cursive — system fonts, no webfont), written in Kevin's first-person voice. Default **green `#059669`** (`#34d399` in dark) — the one sanctioned green in the project, approved 2026-08-05 for these annotations only, precisely because they should read as outside the app's palette. `.margin-note.important` = red `#ef4444` for the notes that matter most. Pinned `grid-column: 3`, `display: none` under 760px. Source order decides the row: place the note right after that row's demo card (or the help card when there's no demo).
- **UI design exploration:** iterate with self-contained static mockups in `archive/` (gitignored) — one file per variant (`pm-v1.html` … `pm-v9.html`), each replicating the real board's CSS (white 200px day cards, blue today, real task-row anatomy) with a cross-linked nav bar and an explainer box, using real scenario data. The maintainer picks/combines across variants ("v9 = v6's circle + v8's numbers, reversed"); build the winner only after they converge. Don't prototype inside `index.html`.
- **New interactive features: reuse an existing idiom before inventing a UI primitive.** When a feature idea implies a new selection/hit-testing model (e.g. "click the SVG thread between two chained tasks and hit Delete"), check whether an existing per-row pattern already covers it — hover-reveal icon (`.task-lock`, now `.task-unlink`), hover+keypress (priority 1/2/3), or click-to-popup (lock popup) — before building the novel interaction. The `#chainOverlay` SVG threads are intentionally `pointer-events: none` and redrawn only on hover, so making them clickable would require adding persistent rendering, per-segment task-id metadata, and a new hit-testing/selection concept from scratch. The unlink feature shipped instead as a hover-reveal ✂️ next to the chained row, matching `.task-lock`'s existing pattern — cheaper, more consistent, and it reused `spliceOutOfChain`-adjacent server logic (a new `parent_task_id = NULL` update) with no new frontend primitives.
- zsh gotcha: don't name a shell variable `UID` in test scripts — it's read-only and the assignment errors out.
