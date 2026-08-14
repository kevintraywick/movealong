# Move Along Backend

Node.js/Express API with SQLite (via sql.js) for the Move Along task tracker.

## Setup

```bash
cd server
npm install
npm start
```

Server runs on `http://localhost:3000` by default.

## Database

SQLite database stored at `./movealong.db` (created automatically on first run).
Uses sql.js (pure JavaScript SQLite) - no native compilation required.

To use a different path:
```bash
DB_PATH=/path/to/db.sqlite npm start
```

## API Endpoints

### Companies

#### Sign in or sign up
```
POST /api/companies
Body: { "companyName": "Alice's Move Along", "userName": "Alice" }
Response: { company: {...}, user: {...}, returning?: true }
  201  new team created, or an existing team gained a new member
  200  existing team + existing user — signed back into that account
```
The company name is reduced to a subdomain (`generateSubdomain`) and the user
name to a slug (`generateSlug`); those two together identify the account.

This endpoint used to `409` on an existing team name, which made the header form
a one-way door — after signing out there was no way back to an account. Since
MoveAlong has no authentication (any board is reachable by URL), a known team +
user name now signs you back in rather than failing. Consequences worth knowing:

- Re-entering your names returns the **same** user row and all existing boards.
  The client must therefore `GET .../projects` rather than assuming it should
  create a default "Personal" project.
- Entering an existing team name with a **new** user name joins that team as a
  new member (201). There is no invitation step and no way to refuse.
- Name collisions are account collisions. Two different people who both pick
  team "personal" + user "kev" land on the same board.

#### Get company by subdomain
```
GET /api/companies/:subdomain
Response: { id, name, subdomain, created_at }
```

### Users

#### List all users in company
```
GET /api/companies/:subdomain/users
Response: [{ id, name, slug, initials, color, created_at }, ...]
```

#### Get user by slug
```
GET /api/companies/:subdomain/users/:slug
Response: { id, name, slug, initials, color, created_at }
```

#### Create user (for task assignment)
```
POST /api/companies/:subdomain/users
Body: { "name": "Bob R" }
Response: { id, name, slug, initials, color }
```

### Projects

#### List a user's projects
```
GET /api/companies/:subdomain/users/:slug/projects
Response: [{ id, name, slug, created_by, created_at, due_today }, ...]
```

`due_today` counts that user's locked (deadline) tasks in the project that
are incomplete and scheduled on or before today — past-due locks included.
The frontend uses it to put a red border on the tabs of boards the user
isn't currently looking at, so a deadline on another project is visible.

Projects come back in the user's own tab order: `project_members.position`
first, then creation order for any project never dragged. New projects
therefore append rather than jumping to the front.

#### Create a project
```
POST /api/companies/:subdomain/users/:slug/projects
Body: { "name": "winter con" }
Response: { id, name, slug, created_by, created_at }
```

#### Rename a board
```
PUT /api/companies/:subdomain/users/:slug/projects/:projectId
Body: { "name": "Dog House" }
Response: { id, name, slug }
  400  blank name
  409  another project in the company already takes that slug
  404  no such project, or the caller isn't a member
```
The **slug is regenerated** from the new name (`projectSlugFrom()`, shared with
create so the two rules can't drift). Nothing addresses a project by slug —
the frontend does no URL routing and keys everything off `project_id` in
localStorage — so a frozen slug would only drift away from the name for no
benefit. Renaming is company-wide, not per-user: unlike delete and tab order,
one name is shared by every member.

**This route must stay declared after `PUT .../projects/order`.** Express
matches in declaration order, so a `:projectId` param above it would swallow
`order` and break tab reordering.

#### Remove a board (per-user)
```
DELETE /api/companies/:subdomain/users/:slug/projects/:projectId
Response: { removed, name, tasks_deleted, project_destroyed }
  409  the caller's only board — refused
  404  no such project, or the caller isn't a member
```
Deletion is **per-user**, matching membership and tab order. It drops the
caller's `project_members` row and their own tasks (and those tasks' subtasks)
on that board. Another member's tasks and membership are untouched, and they
keep seeing the board. The `projects` row itself is destroyed only when the last
member leaves.

`tasks.project_id` is `ON DELETE SET NULL`, so the route deletes tasks
**explicitly** — relying on the foreign key would set them to `project_id =
NULL`, where neither the calendar (filters by project) nor the List view (groups
by project) can reach them, and nothing would ever clean them up.

A user's last board can't be removed: zero projects is an empty state with no
way out, since the header's + button renders beside the tab bar. No undo.

#### Reorder a user's project tabs
```
PUT /api/companies/:subdomain/users/:slug/projects/order
Body: { "project_ids": [7, 3, 5] }
Response: { project_ids: [ ...full order as stored... ] }
```

Positions are written 0..n on `project_members`, so order is per-user — one
member rearranging their tabs never reorders anyone else's. Ids the user
doesn't belong to are ignored, duplicates collapse, and any project omitted
from the list keeps its relative order at the end.

### Tasks

#### Get user's tasks
```
GET /api/companies/:subdomain/users/:slug/tasks
Response: [{ id, description, scheduled_date, origin_date, locked, priority, completed, assigned_by, assigned_by_name, ... }, ...]
```

#### Create task
```
POST /api/companies/:subdomain/users/:slug/tasks
Body: { "description": "Do the thing", "scheduled_date": "2024-12-19" }
Response: { id, description, scheduled_date, requested_date, completed, ... }
```

The server caps pending tasks per (owner, project) per day at 10. If the
requested day is already at the cap, the server places the task on the
first subsequent day with capacity and returns that as `scheduled_date`.
`requested_date` echoes the client's original input so clients can detect
overflow by comparing the two.

`origin_date` is set to the requested day at creation and never changes
afterward — spillover, reschedules, assign, and return all preserve it.
It drives the frontend's days-pushed counter (inclusive days from origin
to max(scheduled_date, today), hidden on the origin day).

#### Update task (complete, reschedule, lock, repeat)
```
PUT /api/tasks/:taskId
Body: { "completed": true } or { "scheduled_date": "2024-12-20" }
   or { "locked": true } or { "priority": 3 }
   or { "repeat_rule": "monthly" }
Response: { updated task }
```

`repeat_rule` is `null` (one-off) or one of `"daily"` / `"weekly"` /
`"monthly"`; anything else is coerced to `null`. It is **refused on
`source = 'calendar'` rows** — an imported event is already regenerated by
the feed, so a second regeneration source would duplicate it.

Setting a rule schedules nothing on its own. **Completing a repeating task is
what creates the next instance**, at +1 day / +7 days / +1 month from the
completed instance's own `scheduled_date` (so a rhythm doesn't drift when you
tick something late; month arithmetic clamps, so Jan 31 → Feb 28). The new row
inherits `description`, `project_id`, `locked`, `priority` and the rule, gets
its own `origin_date`, and carries **no** `parent_task_id` — it is a
free-standing task, not a series member. It also respects the 10/day capacity
cap and overflows forward like a hand-created task. Assigning or returning a
task clears its repeat, exactly as it clears the lock.

`priority` is `0` (none) through `3` (most urgent) and is clamped to that range
server-side. It is display/ordering only — it never touches `scheduled_date`,
so it triggers no series cascade and no spillover. The day board sorts its
pending list highest-priority-first client-side; the master route sorts
server-side (`ORDER BY priority DESC, scheduled_date, created_at`).

`locked: true` pins the task to its `scheduled_date` (send `scheduled_date`
too to lock to a future day). Locked tasks are exempt from the auto-spillover
of incomplete past tasks, and a locked past-due task pulls the calendar's first
visible day back to its lock date. Assigning or returning a task clears its lock.

Changing `scheduled_date` on a series member cascades: every later step in
the series shifts by the same number of days, stopping at (and before) the
first locked step. Completed steps never move but don't stop the cascade.

#### Link task into a series
```
POST /api/tasks/:taskId/link
Body: { "parent_task_id": 7 }
Response: { updated task }
```

Makes the task the step immediately after `parent_task_id` and moves it to
that task's day + 1 (`origin_date` untouched). If the parent already had a
next step, the task splices in between. Linking an already-chained task
repositions it (it is spliced out of its old slot first). Both tasks must be
pending, same owner, same project.

#### Unlink task from its predecessor
```
POST /api/tasks/:taskId/unlink
Response: { updated task }
```

Clears `parent_task_id` on the task only — its own successors stay attached,
so the task becomes the root of a new, separate series. 404 if the task
doesn't exist, 400 if it has no predecessor to unlink. This is distinct from
the splice-out used by assign/delete (which bypasses the whole task,
re-linking its successor directly to its predecessor).

#### Assign task to another user
```
POST /api/tasks/:taskId/assign
Body: { "to_user_id": 2, "scheduled_date": "2024-12-20" }
Response: { updated task }
```

#### Return task to sender
```
POST /api/tasks/:taskId/return
Body: { "scheduled_date": "2024-12-20" }
Response: { updated task }
```

#### Delete task
```
DELETE /api/tasks/:taskId
Response: { success: true }
```

#### Master ("List" view) page
```
GET /api/companies/:subdomain/users/:slug/master
Response: { projects: [{ id, name, slug, tasks: [...] }] }
```

Open (uncompleted) tasks grouped by project, each list sorted
`priority DESC, scheduled_date, created_at`. Task rows carry
`id, description, scheduled_date, completed, assigned_by, priority,
locked, repeat_rule, subtask_count, completed_subtask_count` — a hand-listed column
set, so new flags the List view needs must be added to the SELECT
explicitly (`locked` drives the red deadline date).

### Reorder a day's tasks
```
PUT /api/companies/:subdomain/users/:slug/tasks/order
Body: { task_ids: [3, 1, 2], scheduled_date: "2026-08-14", project_id: 4 }
Response: { task_ids: [ ...the order actually stored... ] }
```

Writes `tasks.position` as a dense 0..n-1 sequence over one day of one board.
Both reorder gestures — dragging a row to an edge, and hovering plus pressing
1-9 — go through this single endpoint, so they cannot disagree about where a
task sits.

Defensive in the same way as `projects/order`: ids the caller doesn't own on
that day are dropped, duplicates collapse to their first occurrence, and any
owned task the payload omitted is **appended** rather than lost — a partial or
hostile list can never knock a task off the board. Assignment hands over
`owner_id` outright, so the `owner_id` filter already excludes anything given
away. Completed and `source = 'calendar'` rows are excluded; events are
force-sorted above everything by `event_start`, so a position among them would
never be read.

**MUST stay declared before any `.../tasks/:param` sibling** — Express matches in
declaration order, and a `:taskId` above would swallow the literal `order`.

A day holds at most 10 pending tasks, so the whole day is rewritten on every
change rather than maintaining sparse or fractional indices; at that size it is
cheaper and it cannot drift.

### Generate subtasks
```
POST /api/tasks/:taskId/generate-subtasks
Headers: x-ai-key: <AI_ACCESS_KEY>   (required for real AI only when the
                                      server sets AI_ACCESS_KEY)
Response: { subtasks: [full ordered set], research_status, full? }
```

**Tops the pane up to 7 — it does not wipe it.** Every pending row survives,
including steps the user typed. Only the slots freed by *completing* a step are
refilled, and the model is shown the kept steps so it doesn't re-propose them.
When nothing has been freed the response carries `full: true` and no AI call is
made. There is deliberately no delete affordance on a subtask row, so ticking a
step off is the only way to free a slot.

Falls back to mock subtasks when no `ANTHROPIC_API_KEY` is configured, when the
caller lacks a valid `x-ai-key` while `AI_ACCESS_KEY` is set, or when rate caps
(`AI_LIMIT_PER_IP_HOUR`, `AI_LIMIT_GLOBAL_DAY`) are exceeded.

`research_status` is `null` (nothing to research — mocks), `'running'`
(phase 2 dispatched) or `'over_budget'`.

**Two-phase generation.** Phase 1 is a fast reasoning-only call; its rows are
written with `provisional = 1` and render greyed. Phase 2 (`runResearch()`) then
runs *behind the response* with the `web_search` tool and rewrites those rows in
place. It never adds, removes or reorders: results are matched back by index, and
each row is re-read immediately before writing, so a row the user ticked off or
promoted mid-flight is skipped rather than resurrected. A step is **replaced**
outright only when the model calls it illogical with confidence ≥ 0.8
(`RESEARCH_REPLACE_CONFIDENCE`); otherwise it is refined in place.

Phase 1 rows are marked provisional **only when phase 2 will actually run** —
mock rows and over-budget boards produce final text, since greying out something
that will never be refined just reads as broken.

**"list …" tasks** (description matches `/^list\b/i`) behave differently: the AI
prompt asks for 7 concrete candidate items for the list (not action steps), every
generated row is forced to `assignee_type: 'ai'`, and only rows with
`assignee_type = 'ai'` are deleted first (the user's own quick-list items are
preserved). A list pane is **not** topped up — "My list" and "Suggestions" are
separate sections, so capping the two together would starve suggestions. The
frontend's ↑ "Move to my list" button flips a suggestion to
`assignee_type: 'human'` via `PUT /api/subtasks/:id`, which both moves it into
the quick list and shields it from future regeneration.

### Promote a subtask onto the board
```
POST /api/subtasks/:subtaskId/promote
Response: { task: {...}, scheduled_date }
```

Creates a real task from the subtask and deletes the subtask row. It lands on the
**parent task's day**, not today — the pane may be open under next Tuesday
because that is when the user plans to do this — and goes through
`findDayWithCapacity()` so it can't blow the 10/day cap. Dependent subtasks are
lifted to the promoted row's own parent first, since `ON DELETE CASCADE` would
otherwise destroy them. Its departure is what frees a slot in the pane's 7.

### Research one subtask
```
POST /api/subtasks/:subtaskId/research
Response: { updated subtask }
402: { error: 'over_budget', spent, budget }
```

What the → arrow on an AI row does (it used to only toast "Agent dispatched").
Same machinery as the whole-task pass, scoped to one row, and subject to the same
0.8 replacement gate and board budget.

### AI budget
```
GET /api/projects/:projectId/budget
PUT /api/projects/:projectId/budget   Body: { budget_usd }
Response: { month, budget_usd, spent_usd }
```

A per-board, per-month dollar cap on **research**, defaulting to $5. Whole
dollars only, 0–1000. Phase 1 generation is never blocked by it — a task the user
just typed must always come back with something — so an exhausted board still
drafts steps, it just stops researching them and says so in the pane.

Spend is metered from the API's own `usage` (including
`server_tool_use.web_search_requests` at $10/1000) and written one row per call
to `ai_usage`, so a month's spend is an audit trail rather than a bare counter.

### Calendar feed

One subscribed iCal feed per user. Turning the feature on imports the next
**14 days** of timed events as ordinary task rows carrying `source='calendar'`.

The feed URL is a **bearer credential for the entire calendar**. It is stored
server-side and never returned unmasked. Note the consequence in an app with no
authentication: enabling this puts event titles on a board that anyone who
knows the team + user name can load.

#### Get status
```
GET /api/companies/:subdomain/users/:slug/calendar
Response: {
  connected: true, enabled: true,
  url_masked: "calendar.google.com/…",
  timezone: "America/Los_Angeles",
  last_synced_at: "...", last_status: "ok", last_error: null,
  event_count: 12, window_days: 14
}
```
Returns `{ connected: false, enabled: false }` when no feed is set up.

#### Connect / change / enable / disable
```
PUT /api/companies/:subdomain/users/:slug/calendar
Body: { url, timezone }        -> connect or replace the feed (syncs immediately)
Body: { enabled: false }       -> stop importing; deletes the imported rows but
                                  KEEPS the URL, so turning it back on costs no re-paste
Response: the same status object; 400 with { error } on a bad or unreachable URL
```
`url` accepts `https://` or `webcal://` (rewritten to https). Rejected: any
other scheme, and loopback / link-local / private-range hosts — the server
fetches this URL, so an unguarded value is an SSRF primitive. Replacing the URL
with a different calendar clears the previously imported rows.

#### Force a sync
```
POST /api/companies/:subdomain/users/:slug/calendar/sync
Response: status object + { created, updated, removed, total }
```
Bypasses the 15-minute throttle. Normally syncs happen lazily and
fire-and-forget from `GET .../tasks`, so the board never waits on the network.

#### Disconnect
```
DELETE /api/companies/:subdomain/users/:slug/calendar
Response: { connected: false, enabled: false }
```
Deletes the imported rows and the stored URL.

#### Reconciliation rules worth knowing
- Events are matched on `external_uid` and **updated in place**, never
  deleted-and-recreated: subtasks `CASCADE` on task delete, so recreating would
  destroy any subtask pane built on an event. `completed` is never touched.
- **A failed fetch never reconciles.** Treating a 404 (the user regenerated
  their secret address) as "no events" would wipe the board.
- Past events are **pruned, not spilled** — and pruning runs even when the
  fetch fails, since it needs no network knowledge.
- Filtered out: all-day events, anything marked free/`TRANSP:TRANSPARENT`
  (how holidays and birthdays are tagged), and `STATUS:CANCELLED`.

### Health Check
```
GET /health
Response: { status: "ok", timestamp: "..." }
```

## URL Structure

- Company URL: `{subdomain}.movealong.com`
- User URL: `{subdomain}.movealong.com/{user_slug}`

Example:
- Alice creates "Alice's Move Along" → `alices.movealong.com`
- Alice's board: `alices.movealong.com/alice`
- Bob gets assigned a task: `alices.movealong.com/bobr`

## Data Model

```
companies
├── id (PK)
├── name ("Alice's Move Along")
├── subdomain ("alices")
└── created_at

users
├── id (PK)
├── company_id (FK)
├── name ("Alice")
├── slug ("alice")
├── initials ("A" or "AB")
├── color ("#9575cd")
└── created_at

tasks
├── id (PK)
├── company_id (FK)
├── owner_id (FK → users) - whose board it's on
├── assigned_by (FK → users, nullable) - who assigned it
├── description
├── scheduled_date
├── origin_date - day first requested for; immutable, drives days-pushed counter
├── parent_task_id (FK → tasks, nullable) - predecessor in a series (linked list)
├── locked (0/1) - pinned to scheduled_date, exempt from spillover
├── position - manual order within a day (NULL sorts last); see tasks/order
├── priority - deprecated; nothing reads it since 2026-08-14
├── repeat_rule - NULL | daily | weekly | monthly; completing spawns the next
├── completed (0/1)
├── completed_at
├── created_at
└── updated_at
```

## Next Steps

1. **Subdomain routing** - Configure DNS wildcard + nginx/proxy to route `*.movealong.com` to this API
2. **Frontend integration** - Update frontend to make API calls instead of local state
3. **Authentication** - Currently none; user slug in URL is the "key"
4. **Rate limiting** - Add if needed for public deployment
