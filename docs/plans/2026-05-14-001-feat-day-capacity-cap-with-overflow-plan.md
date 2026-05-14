---
title: "feat: Cap day at 10 pending tasks with overflow to next day with capacity"
type: feat
status: active
date: 2026-05-14
deepened: 2026-05-14
---

# feat: Cap day at 10 pending tasks with overflow to next day with capacity

## Overview

When a user creates a task on a day that already has 10 pending tasks, place the task on the next day that has room (fewer than 10 pending). The cap is enforced server-side on task creation only; the server returns the day it actually placed the task on, and the client surfaces the result via a toast and a brief flash on the target day-card.

## Problem Frame

Days currently grow vertically without limit. A user spamming tasks into "today" produces an unmanageable column and undermines the app's core promise — moving ideas into action by surfacing today's small, finite plan. A 10-task ceiling per day forces decisions about deferral instead of pile-ups, with the system auto-routing overflow rather than rejecting it.

## Requirements Trace

- **R1.** A day holds at most 10 *pending* tasks (`completed = 0` and currently `owner_id = user`). Completed tasks and tasks the user has assigned out (which leave their board entirely) do not count.
- **R2.** When a user creates a task targeted at a day already at 10 pending, the server places it on the first subsequent calendar day with fewer than 10 pending.
- **R3.** If all 7 visible days are full, the task lands on the first future day past the visible window with capacity. The task is real and persisted; only its visibility changes (it appears once the day enters the window via scroll/expand).
- **R4.** The user sees clear feedback when the placement differs from the requested day — a toast naming the effective date.
- **R5.** Assignment, return, and manual move (the `→` arrow) flows are *not* gated by the cap. Only direct user-initiated task creation is.

## Scope Boundaries

- **Non-goal:** Retroactive rebalancing. Existing days with >10 pending tasks (created before this change, or created via assignment/return/move flows) stay as-is.
- **Non-goal:** Capping assignment (`POST /api/tasks/:id/assign`), return (`POST /api/tasks/:id/return`), or manual moves (`PUT /api/tasks/:id` with new `scheduled_date`). Confirmed by user — creation-only.
- **Non-goal:** Capping `POST /api/subtasks/:id/assign` (server/src/server.js:748-794). Although this endpoint *does* INSERT a new row into `tasks` (server.js:768-771) on the assignee's board, it is semantically an assignment: the user is offloading a subtask to someone else with an explicit target date, not creating fresh work on their own board. Treating it as creation would silently override the user's explicit assignment date and would contradict the "assign is not capped" decision. Therefore the cap does *not* apply to this path.
- **Non-goal:** Changing the existing past-incomplete spillover behavior in `GET /api/.../tasks` (server.js:332-346). Even if it pushes today's count above 10, that's pre-existing implicit movement and not the surface this feature governs.
- **Non-goal:** A pre-emptive "day full" hint in the UI before the user types. The only feedback is post-submission via toast.
- **Non-goal:** Configurable cap. The value is a single named constant; making it per-user or per-project is out of scope.

## Context & Research

### Relevant Code and Patterns

- **Task creation endpoint:** `server/src/server.js:376-417` — `POST /api/companies/:subdomain/users/:slug/tasks`. Currently inserts with whatever `scheduled_date` the client sent. This is the one endpoint that needs to enforce the cap.
- **Task ordering on read:** `server/src/server.js:369` — `ORDER BY t.scheduled_date, t.created_at`. No `sort_order` column exists on `tasks`; insertion order within a day is by `created_at`. No schema change needed.
- **Past spillover:** `server/src/server.js:332-346` — bulk UPDATE on GET that moves all incomplete past tasks to today. Runs unconditionally and ignores the new cap (per scope decision).
- **Frontend task creation:** `server/public/index.html:1867-1897` (`addTask`). After POST, it pushes the returned task into local `tasks`, expands it, and kicks off subtask generation. The toast call site already exists (`showToast`) for error paths.
- **Frontend day window:** `server/public/index.html:1653-1669`. 7-day rolling window, `key` = ISO date string. The frontend filters by `scheduled_date === day.key` (line 2140) so any task with a date past day 7 is simply not rendered, which is exactly what we want for past-window overflow.
- **Date helpers:** `getTodayKey()` and `getTomorrowKey()` (server/public/index.html:1671-1679). The plan will not add new date helpers on the client; the server returns the effective date and the client treats it as canonical.

### Institutional Learnings

- None applicable. `docs/solutions/` does not exist.

### External References

- Not required. This is straightforward CRUD constraint logic with no external API or framework gotcha.

## Key Technical Decisions

- **Decision: pending = `completed = 0` only.** Once a task is marked complete or assigned to another user, it no longer occupies a slot. Rationale (R1): completed tasks are visually dimmed, and assigned-out tasks literally change ownership (`owner_id` shifts), so they're gone from the user's day from the DB's perspective.
- **Decision: server enforces, client displays.** The client sends its requested `scheduled_date` unchanged. The server may pick a different one and returns the chosen value in the response payload. The client compares request vs response to decide whether to toast.
- **Decision: linear forward search, no upper bound.** Helper iterates `requestedDate, requestedDate+1, requestedDate+2, …` until it finds a day with `<10` pending. No bound on lookahead — if a user has 365 saturated days, the loop runs 366 times, which is acceptable for SQLite single-user workloads. Add a guard at 365 iterations as a defensive ceiling that raises a 500.
- **Decision: count query uses the existing `idx_tasks_owner` and `idx_tasks_date` indexes.** A single `SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND scheduled_date = ? AND completed = 0` per probed day. For the common case (target day is empty or has room), it's one query.
- **Decision: cap is bucketed by (owner, project), not by owner alone.** The helper counts tasks matching the *same* `project_id` value that the new task carries — including `IS NULL` when no project is supplied. Rationale: every board the user actually looks at is project-scoped. `GET /api/.../tasks` filters by `project_id` (server.js:365-368) and `GET /api/.../master` groups by project (server.js:1012-1023); there is no cross-project single-board view. Capping per (owner, project) matches the visual unit the cap protects.
  - **Acknowledged tradeoff:** A user with projects A and B can hold 10 pending tasks on Tuesday on each, totalling 20 absolute pending tasks on that calendar day. This is intentional — the cap is about *visual density of a single board*, not absolute workload. A user feeling overloaded across projects has the master view to see the aggregate; the cap doesn't try to be that signal.
  - **Edge case:** Tasks with `project_id IS NULL` (created when the user has no current project) form their own bucket. They neither count toward nor are limited by project-A's bucket on the same day.
- **Decision: server response always echoes `requested_date` alongside `scheduled_date`.** The create-task response shape becomes `{ id, description, scheduled_date, requested_date, project_id, completed, assigned_by, assigned_by_name }`. The client compares the two to decide whether to toast. Rationale: making `requested_date` always present (rather than only when it differs from `scheduled_date`) keeps the client logic branch-free and avoids ambiguity between "field missing" and "field equals scheduled_date". Older clients that don't read the new field continue to work — the field is additive.
- **Decision: cap constant lives in `server/src/server.js`.** `const MAX_TASKS_PER_DAY = 10;` at the top of the file. No config module yet; one file change is the lighter footprint.

## Open Questions

### Resolved During Planning

- **What counts toward the 10?** → Pending only (`completed = 0` AND task is still owned by the user).
- **What if all 7 visible days are full?** → Place on the first day past the window with capacity. User sees a toast naming the date.
- **Does the cap apply to assign/return/move?** → No. Creation only.
- **Per-project or per-user count?** → Per (owner, project) bucket. `project_id IS NULL` is its own bucket. Mirrors how the boards filter — see Key Technical Decisions for the full rationale and acknowledged cross-project tradeoff.
- **Does the cap apply to `POST /api/subtasks/:id/assign`?** → No. That endpoint INSERTs a task row (server.js:768-771) but is semantically an assignment, not a creation. See Scope Boundaries for the full reasoning.
- **Response shape — should `requested_date` be optional or always present?** → Always present. See Key Technical Decisions.

### Deferred to Implementation

- **Toast copy specifics.** Final wording for in-window overflow ("Monday full — moved to Tuesday") and past-window overflow ("All 7 days full — scheduled for May 23") will be polished during implementation; the structure is fixed but the exact phrasing is a UX micro-decision best made when looking at the running app.
- **Brief visual flash on the target day-card.** Whether to add a CSS keyframe pulse on the day that received the overflowed task is a nice-to-have. Decide during implementation based on whether the toast alone reads clearly enough.

## Implementation Units

- [ ] **Unit 1: Server — capacity helper and constant**

**Goal:** Introduce the cap constant and a helper that takes a requested date and returns the effective placement date for a given user/project.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `server/src/server.js`

**Approach:**
- Add `const MAX_TASKS_PER_DAY = 10;` near the top of the file (above route definitions).
- Add a helper `findDayWithCapacity({ ownerId, projectId, requestedDate })` that:
  - Counts pending tasks (`completed = 0`) for `owner_id = ownerId` on `scheduled_date = requestedDate`, filtered by `project_id` when supplied (and `project_id IS NULL` when not — matches existing master/project semantics).
  - Returns `requestedDate` if count `< MAX_TASKS_PER_DAY`.
  - Otherwise increments the date by 1 day (ISO `YYYY-MM-DD` math) and re-queries.
  - Guards at 365 iterations and throws a labelled error so the route can return a 500 with a recognisable message rather than looping forever.
- Helper is pure server-side; not exported, used only by the task creation route.

**Patterns to follow:**
- Existing helper conventions in `server/src/server.js` (e.g., `generateSlug` near the top of the file).
- SQL parameter binding style already used throughout the file (`queryOne('… WHERE … = ?', [value])`).

**Test scenarios:** (manual — no test framework in repo)
- Helper returns requested date when day count is 0, 1, …, 9.
- Helper returns `requested + 1` when day count is exactly 10.
- Helper skips multiple full days in a row (10, 10, 10, 9) and returns the first <10.
- Helper respects project filter: when `project_id` is provided, only counts tasks for that project; when null, only counts tasks where `project_id IS NULL`.
- Helper throws after 365 iterations of all-full days.

**Verification:**
- The helper is callable with a known-loaded user/date and returns the expected effective date by direct invocation in a Node REPL or via the integration test in Unit 2.

- [ ] **Unit 2: Server — wire helper into task creation endpoint**

**Goal:** Make `POST /api/companies/:subdomain/users/:slug/tasks` consult the helper and persist the task on the effective date, returning that date to the client.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `server/src/server.js` (the existing route handler at lines 376-417)

**Approach:**
- After resolving `company` and `user`, but before the INSERT, call `findDayWithCapacity({ ownerId: user.id, projectId: project_id ?? null, requestedDate: scheduled_date })`.
- INSERT with the effective date instead of the request date.
- Response payload echoes both `scheduled_date` (the effective date used in the INSERT) and `requested_date` (the original input). Always include both — see Key Technical Decisions.

**Patterns to follow:**
- Route handler shape already established in the file: `company → user → try/catch around INSERT → 201 response`. No new error-handling pattern.
- Error responses use `{ error: '…' }`. The helper's 365-iteration overflow guard surfaces as a 500 with `{ error: 'No day with capacity within search horizon' }`.

**Test scenarios:** (manual)
- POST with `scheduled_date = today` when today has 9 pending → response `scheduled_date = today`, `requested_date = today`, DB row scheduled today.
- POST with `scheduled_date = today` when today has 10 pending → response `scheduled_date = tomorrow`, `requested_date = today`.
- POST with `scheduled_date = today` when today, tomorrow, day3 all have 10, day4 has 7 → response `scheduled_date = day4`.
- POST with `scheduled_date = today + 14` (past visible window) when that day already has 10 → response `scheduled_date = today + 15` (or further). Confirms the helper is symmetric and doesn't special-case the visible window.
- POST with `project_id = A` when day has 10 project-A tasks and 0 project-B tasks → response `scheduled_date = tomorrow`. Confirms project scoping.
- POST with no `project_id` when day has 0 user-level tasks but 10 project-A tasks → response `scheduled_date = today`. Confirms project NULL-filtering.

**Verification:**
- `curl` the endpoint with a known dataset and confirm the response `scheduled_date` matches expectations. SQLite row count for `scheduled_date = <effective>` increases by 1.

- [ ] **Unit 3: Frontend — surface overflow in addTask**

**Goal:** When the server places the task on a date different from what the user requested, show a toast that names the effective date.

**Requirements:** R4

**Dependencies:** Unit 2 (response shape must include `requested_date`)

**Files:**
- Modify: `server/public/index.html` (the `addTask` function at lines 1867-1897)

**Approach:**
- After `await api(...)`, compare `newTask.scheduled_date` to `dateKey` (the originally requested date).
- If they differ:
  - If the effective date is within the visible 7-day window: toast `"<requested-day-name> full — moved to <effective-day-name>"` (e.g., "Monday full — moved to Tuesday").
  - If the effective date is past the window: toast `"All 7 days full — scheduled for <effective-date-formatted>"` (e.g., "scheduled for May 23").
- Continue with the existing subtask-generation flow unchanged.
- Optionally, briefly flash the target day-card by toggling a `.day-card.just-received` class with a CSS keyframe pulse for ~600ms. Decide during implementation whether the toast alone is enough.

**Patterns to follow:**
- Existing `showToast` calls in the same function (line 1895) and elsewhere — single-string toast, no styling variants today.
- Day-name resolution: the `days` array (line 1669) has `dayName` and `dateStr`. For in-window dates, find by `days.find(d => d.key === effective)`. For past-window dates, format directly: `new Date(effective).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`.

**Test scenarios:** (manual via running app)
- Add the 11th task to today → toast "Monday full — moved to Tuesday" (or whatever the days are), task lands in the Tuesday column.
- Fill all 7 visible days to 10 each, then add → toast "All 7 days full — scheduled for <date past window>", task is *not* visible on the board (correctly, because it's outside the window).
- Add a task to a non-full day → no toast (matches existing behaviour).

**Verification:**
- Manually exercise the three scenarios above in the running app; confirm toast wording and that the task appears on the correct day-card (or doesn't, for past-window).

- [ ] **Unit 4: Update reference docs and CLAUDE.md**

**Goal:** Document the new contract so future work doesn't accidentally re-derive or contradict it.

**Requirements:** N/A — supporting work

**Dependencies:** Units 1-3 ship together

**Files:**
- Modify: `reference/api-reference.md`
- Modify: `CLAUDE.md`

**Approach:**
- `reference/api-reference.md`: under the "Create task" section, add a note: "Server may place the task on a later date if the requested day already holds 10 pending tasks. Response `scheduled_date` reflects the effective date; `requested_date` echoes what the client asked for."
- `CLAUDE.md`: add one line under "Key Design Decisions": "Day capacity: max 10 pending tasks per day. New tasks created on a saturated day overflow to the next day with capacity (creation-only; assign/return/move are not capped)."

**Patterns to follow:**
- Existing docs style is plain markdown with short bullets. Mirror it.

**Test scenarios:** N/A

**Verification:**
- Diff is two small additions, both readable in isolation.

## System-Wide Impact

- **Interaction graph:** Only `POST /api/companies/:subdomain/users/:slug/tasks` changes contract. All other task endpoints (PUT, assign, return, delete, subtask routes including `POST /api/subtasks/:id/assign`) are untouched.
- **Error propagation:** Helper's 365-iteration guard surfaces as a 500 with a descriptive message. Frontend's existing `try/catch` in `addTask` catches it and shows the generic error toast — acceptable because hitting 365 saturated days is effectively impossible in normal use.
- **State lifecycle risks:** Race condition — two concurrent POSTs both observing 9 pending on the same day will both land, producing 11. Acceptable: sql.js is single-threaded per process and MoveAlong is single-user-per-tab. Documented; not engineered around.
- **Interaction with past-incomplete spillover (server.js:332-346):** The GET tasks endpoint bulk-moves incomplete tasks from past dates onto today on every read. The cap is computed at POST time against the *current* DB state, so the helper always sees the post-spillover count. Concrete scenarios:
  - **Scenario A — Today over cap before user types.** User returns after a 3-day absence. Spillover deposits 8 incomplete past tasks onto today. Today already had 5 pending, so it's now at 13. User adds a new task → helper sees 13, overflows to tomorrow. Toast: "Today full — moved to tomorrow." This is the *correct* behavior: the user shouldn't keep piling onto an over-cap today even though the cap didn't create that state.
  - **Scenario B — Today exactly at cap.** Today has 10 pending. User adds a task → overflow to tomorrow. Standard path.
  - **Scenario C — Spillover pushes today past cap during the session.** Today has 9 pending. User adds task #10 → lands on today (count=10). User reloads the page; the GET-side spillover finds nothing new to spill. State stays at 10. No regression.
  - **Sequencing assumption:** The board loads via `loadTasks()` (which triggers the GET-side spillover) before any input field is rendered, so a POST cannot fire before spillover has reconciled the date column. If a future change ever decouples those — e.g. allowing task creation from a not-yet-loaded master view — the cap would briefly compute against pre-spillover state, which could *under*-count today (missing future-spilled tasks) and lead to a temporarily over-cap today. This is a flag for future work, not a current bug.
- **API surface parity:** The `requested_date` field is additive to the create response. Existing clients (older builds in browser cache) keep working since they don't read this new field. No version bump needed.
- **Integration coverage:** Manual exercise of three scenarios in Unit 3 covers the end-to-end path (client → server → DB → response → toast). No automated test suite exists in the repo; the cost-benefit of introducing one for this single feature is low.

## Risks & Dependencies

- **Risk: User confusion when a task vanishes past the visible window.** Mitigation: the toast explicitly names the effective date, so the user knows their task landed somewhere even if they can't see it.
- **Risk: Existing dbs already have days with >10 pending tasks.** Mitigation: the cap only blocks new creation; existing rows are untouched. The cap is a forward constraint, not an invariant.
- **Risk: AI-generated subtasks generate quickly while overflow is happening.** Mitigation: subtask generation is keyed off `newTask.id`, which the server returns regardless of which day the task landed on. The expand-and-generate flow works identically whether the task is on the requested or overflowed day.
- **Dependency: SQLite single-threaded write semantics.** No locking concerns for single-user usage. If MoveAlong later adds multi-tab or concurrent assignment flows, revisit the race-condition handling.

## Documentation / Operational Notes

- No migration. No schema change. No env var. No rollback needed beyond reverting the commit.
- Railway auto-deploys on push to `main`; this change is a single push.
- No new monitoring. The 500 from the 365-iteration guard is rare enough that adding alerting for it is overkill.

## Sources & References

- Origin: direct user request (no `docs/brainstorms/` document) — "set a max # of tasks per day to 10. new tasks for a day with more than 10 will overflow to the next day with less than 10 items"
- Related code:
  - `server/src/server.js:376-417` — task creation endpoint to modify
  - `server/src/server.js:369` — task ordering (no change needed)
  - `server/src/server.js:332-346` — past spillover (deliberately untouched)
  - `server/public/index.html:1867-1897` — frontend `addTask`
  - `server/public/index.html:1653-1669` — frontend day window
- Schema: `server/src/db.js:70-88` — tasks table (no change needed)
- Reference: `reference/api-reference.md`, `reference/data-model.md` (docs to update)
