# Data Model

## companies
| Column     | Type     | Notes            |
|------------|----------|------------------|
| id         | INTEGER  | PK, autoincrement|
| name       | TEXT     | "Alice's Move Along" |
| subdomain  | TEXT     | UNIQUE, "alices" |
| created_at | DATETIME | auto             |

## users
| Column     | Type     | Notes            |
|------------|----------|------------------|
| id         | INTEGER  | PK, autoincrement|
| company_id | INTEGER  | FK → companies   |
| name       | TEXT     | "Alice"          |
| slug       | TEXT     | "alice", UNIQUE per company |
| initials   | TEXT     | "K" or "KT"     |
| color      | TEXT     | hex color        |
| role       | TEXT     | Display only ("Accounting", "CTO"); nothing branches on it. Shown in the team roster and the shared-board banner |
| share_board| INTEGER  | 0 or 1, default 0. Whether this board is open to the team; the shared-board route 403s without it. A product rule, not a security boundary (no auth) — the seam real permissions go in |
| created_at | DATETIME | auto             |

## tasks
| Column         | Type     | Notes            |
|----------------|----------|------------------|
| id             | INTEGER  | PK, autoincrement|
| company_id     | INTEGER  | FK → companies   |
| owner_id       | INTEGER  | FK → users (whose board) |
| assigned_by    | INTEGER  | FK → users, nullable |
| accepted_at    | DATETIME | When the recipient accepted an assigned task. **NULL + assigned_by set = "awaiting"**: an inbox row, neither accepted nor returned — the server refuses `completed: true` on it, the frontend withholds every affordance but accept/return, and it shows on every board of the recipient (like calendar rows). Assign resets it to NULL; accept stamps it; **return also stamps it** (returning is an answer — the sender must not get an inbox item for their own task back). Backfilled to `updated_at` on the migrating boot so pre-feature assignments don't retroactively appear unanswered |
| description    | TEXT     |                  |
| scheduled_date | DATE     | when locked, this IS the lock date |
| origin_date    | DATE     | day the task was first requested for; never changes (spillover, → moves, assign/return all preserve it). Drives the days-pushed counter: inclusive days from origin to max(scheduled, today), hidden when 1 |
| parent_task_id | INTEGER  | FK → tasks, nullable, ON DELETE SET NULL; predecessor in a series (linked list: each task has at most one successor, enforced at link time) |
| locked         | INTEGER  | 0 or 1; pinned to scheduled_date, exempt from spillover |
| priority       | INTEGER  | **Deprecated 2026-08-14.** Was 1-3 blue exclamation marks, sorting the pending list highest-first. Nothing reads it now; `position` replaced it. `PUT /api/tasks/:id` still accepts it so older clients don't 400, and the column survives only because its values seeded the first `position` backfill |
| promoted_from  | INTEGER  | FK → tasks, nullable, ON DELETE SET NULL. The task this row was promoted out of, as a subtask step. Display-only: the row sits under its source and shows a dot in its circle; hovering it tints the source. SET NULL on delete just drops the cue |
| position       | INTEGER  | Manual order within a day, ascending, dense 0..n-1 after any reorder. **NULL means never positioned and sorts LAST**, which is what lets a newly created task append to the bottom of its day without a single INSERT site knowing this column exists. Written by `PUT .../tasks/order` and — the one deliberate exception — by `placeTaskAfter()` when a promoted step is spliced in under its source. Calendar rows never carry one — they are force-sorted to the top by `event_start` |
| repeat_rule    | TEXT     | NULL (one-off) or `'daily'` / `'weekly'` / `'monthly'`. Only ever ONE instance of a repeating task exists — completing it inserts the next at +1 day / +7 days / +1 month (end-of-month clamped). The new row inherits `locked`, `priority`, `project_id` and the rule, but never `parent_task_id`. Cleared by assign/return; refused on `source = 'calendar'` rows |
| research_status| TEXT     | NULL (never researched) / `'running'` / `'done'` / `'failed'` / `'over_budget'`. Phase 2 of subtask generation. Cleared to `'failed'` on boot for anything left `'running'` by a restart |
| source         | TEXT     | `'user'` (default) or `'calendar'`. Calendar rows are mirrored from the user's iCal feed |
| external_uid   | TEXT     | Calendar rows only: the ICS `UID` + `#` + the instance's date key. A recurring event's every instance shares one UID, so UID alone is not unique. This is the reconciliation key |
| event_start    | TEXT     | Calendar rows only: local `HH:MM`, for the row's time chip and intra-day ordering |
| completed      | INTEGER  | 0 or 1           |
| completed_at   | DATETIME | nullable         |
| created_at     | DATETIME | auto             |
| updated_at     | DATETIME | auto             |

## subtasks

Steps under a task. Only the columns that carry non-obvious behaviour:

| Column | Type | Notes |
|---|---|---|
| assignee_type | TEXT | `'human'` (👩) or `'ai'` (🧠). On a "list …" task this also splits the pane: `'human'` rows are the user's quick list, `'ai'` rows are Suggestions |
| parent_subtask_id | INTEGER | FK → subtasks, ON DELETE CASCADE. Dependents render indented. Promoting a row lifts its dependents to its own parent first, or the cascade would destroy them |
| provisional | INTEGER | 0 or 1. Set by phase 1 **only when phase 2 will actually run**; the research pass rewrites the row in place and clears it. Renders greyed. Cleared on research failure and on boot, or rows stay greyed forever and the frontend polls for a result that is never coming |
| researched | INTEGER | 0 or 1. Marks a row the research pass actually rewrote; those render light blue |
| assigned_task_id | INTEGER | FK → tasks, ON DELETE SET NULL. The task created on the assignee's board when this step was handed over. It is what lets the sender's pane derive `assignment_state` ('awaiting'/'accepted'/'done') without matching description text, and what lets a return un-assign the step |
| completed | INTEGER | Completed rows leave the pane (the server keeps them for the List view's n/m count). There is no delete affordance, so ticking a step off is the only way to free one of the pane's 7 slots |
| cost_kind | TEXT | `'material'` / `'labor'` / `'service'` — or `'none'` (research ran, the step spends nothing) or **NULL** (unknown: never researched, or the estimate fell below `COST_MIN_CONFIDENCE`). The pane total shows `≥` when any pending row is NULL, so the none/NULL split is load-bearing, not cosmetic |
| cost_low / cost_high | REAL | Whole-dollar range. Never a point estimate; `ai.js` orders the bounds so a reversed answer can't render as "$130–$90" |
| cost_unit | TEXT | What the range covers — `'total'` (default, not shown), `'per hour'`, `'each'`, `'per person'` |
| cost_basis | TEXT | What was actually priced ("24x 6ft cedar picket at $4.28"). **Required** — an estimate with no basis can't be checked, so a verdict without one is discarded |
| cost_source_url | TEXT | Where the price came from; makes the chip an `<a>`. `http(s)` only |
| cost_confidence | REAL | 0-1. Written only when ≥ `COST_MIN_CONFIDENCE` (0.5), gated server-side in `runResearch()` |
| cost_as_of | TEXT | `YYYY-MM-DD` of the price. Prices move; a figure with no date is worse than none |

All `cost_*` columns are written **only** by the research pass, and are an
estimate about the world — deliberately never combined with `ai_usage`, which is
metered actuals.

## ai_usage

One row per billed Anthropic call, so a board's monthly spend can be audited
rather than merely counted.

| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| project_id | INTEGER | FK projects, ON DELETE CASCADE. The board being billed. |
| task_id | INTEGER | Which task the call was for. |
| month | TEXT | `YYYY-MM`; the monthly SUM keys off this with `idx_ai_usage_month`. |
| kind | TEXT | `'draft'` (phase 1), `'cost_triage'` (the Haiku pre-pass that labels which steps spend money), or `'research'` (phase 2). One row per call, so a two-call researched task audits as two rows. |
| model | TEXT | |
| input_tokens / output_tokens | INTEGER | Includes cache reads/creates. |
| web_searches | INTEGER | From `usage.server_tool_use.web_search_requests`, billed at $10/1000. |
| cost_usd | REAL | Computed from the per-model `RATES` map in `ai.js` (two models bill in one flow: Sonnet 5 for draft/research, Haiku 4.5 for triage). |

`projects.ai_budget_usd` (whole dollars, default 5) is the monthly cap this is
summed against. It gates **research only** — phase 1 drafting always runs.

## calendar_feeds
One subscribed iCal feed per user (`user_id` is UNIQUE).

| Column         | Type     | Notes            |
|----------------|----------|------------------|
| id             | INTEGER  | PK, autoincrement|
| user_id        | INTEGER  | FK → users, UNIQUE, ON DELETE CASCADE |
| url            | TEXT     | The secret iCal address. **A bearer credential for the whole calendar** — stored server-side, returned to the client only masked |
| timezone       | TEXT     | IANA zone from the browser at connect time; event day keys are derived in it |
| enabled        | INTEGER  | 0 or 1. Turning it off deletes the imported rows but keeps the URL |
| last_synced_at | DATETIME | drives the 15-minute sync throttle |
| last_status    | TEXT     | `'ok'` or `'error'` |
| last_error     | TEXT     | surfaced in the connect popup |
| event_count    | INTEGER  | events in the last successful sync |
| created_at     | DATETIME | auto |

### Calendar rows: three things that are load-bearing
1. **`locked` stays 0.** Board anchoring, red project tabs, red task text and
   the amber edge all gate on `locked`; an imported event carrying it would
   misfire every one of them daily. Exemption from spillover is instead an
   explicit `source != 'calendar'` check in the tasks route — the single guard
   this feature depends on. Setting `locked` on a calendar row is refused by
   `PUT /api/tasks/:id`.
2. **`project_id` is NULL on purpose.** That is what makes one row appear on
   every board. This is the one place a NULL `project_id` is meaningful — do
   not "repair" these rows to a project.
3. **`origin_date` = `scheduled_date`**, so the days-pushed counter reads 1 and
   stays hidden. An event should not grow an age badge.

## Indexes
- `idx_users_company` on users(company_id)
- `idx_users_slug` on users(company_id, slug)
- `idx_tasks_owner` on tasks(owner_id)
- `idx_tasks_date` on tasks(scheduled_date)
- `idx_tasks_parent` on tasks(parent_task_id)
- `idx_tasks_external` on tasks(owner_id, external_uid)
- `idx_calendar_feeds_user` on calendar_feeds(user_id)
- `idx_tasks_assigned_by` on tasks(assigned_by)
- `idx_companies_subdomain` on companies(subdomain)
