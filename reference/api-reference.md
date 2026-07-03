# Move Along Backend

Node.js/Express API with SQLite (via sql.js) for the Move Along task tracker.

## Setup

```bash
cd movealong-backend
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

#### Create company + first user (signup)
```
POST /api/companies
Body: { "companyName": "Kevin's Move Along", "userName": "Kevin" }
Response: { company: {...}, user: {...} }
```

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
Body: { "name": "Katy T" }
Response: { id, name, slug, initials, color }
```

### Tasks

#### Get user's tasks
```
GET /api/companies/:subdomain/users/:slug/tasks
Response: [{ id, description, scheduled_date, completed, assigned_by, assigned_by_name, ... }, ...]
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

#### Update task (complete, reschedule, lock)
```
PUT /api/tasks/:taskId
Body: { "completed": true } or { "scheduled_date": "2024-12-20" } or { "locked": true }
Response: { updated task }
```

`locked: true` pins the task to its `scheduled_date` (send `scheduled_date`
too to lock to a future day). Locked tasks are exempt from the auto-spillover
of incomplete past tasks, and a locked past-due task pulls the calendar's first
visible day back to its lock date. Assigning or returning a task clears its lock.

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

### Health Check
```
GET /health
Response: { status: "ok", timestamp: "..." }
```

## URL Structure

- Company URL: `{subdomain}.movealong.com`
- User URL: `{subdomain}.movealong.com/{user_slug}`

Example:
- Kevin creates "Kevin's Move Along" → `kevins.movealong.com`
- Kevin's board: `kevins.movealong.com/kevin`
- Katy gets assigned a task: `kevins.movealong.com/katyt`

## Data Model

```
companies
├── id (PK)
├── name ("Kevin's Move Along")
├── subdomain ("kevins")
└── created_at

users
├── id (PK)
├── company_id (FK)
├── name ("Kevin")
├── slug ("kevin")
├── initials ("K" or "KT")
├── color ("#9575cd")
└── created_at

tasks
├── id (PK)
├── company_id (FK)
├── owner_id (FK → users) - whose board it's on
├── assigned_by (FK → users, nullable) - who assigned it
├── description
├── scheduled_date
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
