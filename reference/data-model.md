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
| created_at | DATETIME | auto             |

## tasks
| Column         | Type     | Notes            |
|----------------|----------|------------------|
| id             | INTEGER  | PK, autoincrement|
| company_id     | INTEGER  | FK → companies   |
| owner_id       | INTEGER  | FK → users (whose board) |
| assigned_by    | INTEGER  | FK → users, nullable |
| description    | TEXT     |                  |
| scheduled_date | DATE     | when locked, this IS the lock date |
| origin_date    | DATE     | day the task was first requested for; never changes (spillover, → moves, assign/return all preserve it). Drives the days-pushed counter: inclusive days from origin to max(scheduled, today), hidden when 1 |
| parent_task_id | INTEGER  | FK → tasks, nullable, ON DELETE SET NULL; predecessor in a series (linked list: each task has at most one successor, enforced at link time) |
| locked         | INTEGER  | 0 or 1; pinned to scheduled_date, exempt from spillover |
| priority       | INTEGER  | 0 = none, 1-3 = blue exclamation marks (3 = most urgent). Clamped to 0-3 server-side. Sorts the pending list highest-first; never affects dates, spillover, or capacity |
| repeat_rule    | TEXT     | NULL (one-off) or `'daily'` / `'weekly'` / `'monthly'`. Only ever ONE instance of a repeating task exists — completing it inserts the next at +1 day / +7 days / +1 month (end-of-month clamped). The new row inherits `locked`, `priority`, `project_id` and the rule, but never `parent_task_id`. Cleared by assign/return; refused on `source = 'calendar'` rows |
| source         | TEXT     | `'user'` (default) or `'calendar'`. Calendar rows are mirrored from the user's iCal feed |
| external_uid   | TEXT     | Calendar rows only: the ICS `UID` + `#` + the instance's date key. A recurring event's every instance shares one UID, so UID alone is not unique. This is the reconciliation key |
| event_start    | TEXT     | Calendar rows only: local `HH:MM`, for the row's time chip and intra-day ordering |
| completed      | INTEGER  | 0 or 1           |
| completed_at   | DATETIME | nullable         |
| created_at     | DATETIME | auto             |
| updated_at     | DATETIME | auto             |

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
- `idx_companies_subdomain` on companies(subdomain)
