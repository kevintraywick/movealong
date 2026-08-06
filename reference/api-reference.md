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

#### Master ("List" view) page
```
GET /api/companies/:subdomain/users/:slug/master
Response: { projects: [{ id, name, slug, tasks: [...] }] }
```

Open (uncompleted) tasks grouped by project, each list sorted
`priority DESC, scheduled_date, created_at`. Task rows carry
`id, description, scheduled_date, completed, assigned_by, priority,
locked, subtask_count, completed_subtask_count` — a hand-listed column
set, so new flags the List view needs must be added to the SELECT
explicitly (`locked` drives the red deadline date).

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

**"list …" tasks** (description matches `/^list\b/i`) behave differently:
the AI prompt asks for 7 concrete candidate items for the list (not action
steps), every generated row is forced to `assignee_type: 'ai'`, only rows
with `assignee_type = 'ai'` are deleted first (the user's own quick-list
items — `assignee_type 'human'` — are preserved), and the response is the
task's **full** subtask list rather than just the created rows. The
frontend's ↑ "Move to my list" button flips a suggestion to
`assignee_type: 'human'` via `PUT /api/subtasks/:id`, which both moves it
into the quick list and shields it from future regeneration.

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
