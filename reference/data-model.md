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
| scheduled_date | DATE     |                  |
| completed      | INTEGER  | 0 or 1           |
| completed_at   | DATETIME | nullable         |
| created_at     | DATETIME | auto             |
| updated_at     | DATETIME | auto             |

## Indexes
- `idx_users_company` on users(company_id)
- `idx_users_slug` on users(company_id, slug)
- `idx_tasks_owner` on tasks(owner_id)
- `idx_tasks_date` on tasks(scheduled_date)
- `idx_companies_subdomain` on companies(subdomain)
