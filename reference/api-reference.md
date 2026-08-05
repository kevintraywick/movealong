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

#### Create company + first user (signup)
```
POST /api/companies
Body: { "companyName": "Alice's Move Along", "userName": "Alice" }
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
Body: { "name": "Bob R" }
Response: { id, name, slug, initials, color }
```

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

#### Update task (complete, reschedule, lock, prioritize)
```
PUT /api/tasks/:taskId
Body: { "completed": true } or { "scheduled_date": "2024-12-20" }
   or { "locked": true } or { "priority": 3 }
Response: { updated task }
```

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

### Generate subtasks
```
POST /api/tasks/:taskId/generate-subtasks
Headers: x-ai-key: <AI_ACCESS_KEY>   (required for real AI only when the
                                      server sets AI_ACCESS_KEY)
Response: [created subtasks]
```

Replaces the task's subtasks with a fresh AI-generated list, capped at 7
items (falls back to
mock subtasks when no `ANTHROPIC_API_KEY` is configured, when the caller
lacks a valid `x-ai-key` while `AI_ACCESS_KEY` is set, or when rate caps —
`AI_LIMIT_PER_IP_HOUR`, `AI_LIMIT_GLOBAL_DAY` — are exceeded).

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
├── priority (0-3) - red exclamation marks; sorts the pending list
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
