# Data Model

## companies
| Column     | Type     | Notes            |
|------------|----------|------------------|
| id         | INTEGER  | PK, autoincrement|
| name       | TEXT     | "Kevin's Move Along" |
| subdomain  | TEXT     | UNIQUE, "kevins" |
| created_at | DATETIME | auto             |

## users
| Column     | Type     | Notes            |
|------------|----------|------------------|
| id         | INTEGER  | PK, autoincrement|
| company_id | INTEGER  | FK → companies   |
| name       | TEXT     | "Kevin"          |
| slug       | TEXT     | "kevin", UNIQUE per company |
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
| completed      | INTEGER  | 0 or 1           |
| completed_at   | DATETIME | nullable         |
| created_at     | DATETIME | auto             |
| updated_at     | DATETIME | auto             |

## Indexes
- `idx_users_company` on users(company_id)
- `idx_users_slug` on users(company_id, slug)
- `idx_tasks_owner` on tasks(owner_id)
- `idx_tasks_date` on tasks(scheduled_date)
- `idx_tasks_parent` on tasks(parent_task_id)
- `idx_companies_subdomain` on companies(subdomain)
