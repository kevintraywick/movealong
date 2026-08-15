const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { initDb, queryOne, queryAll, runSql, flushDb } = require('./db');

// Calendar import is an optional feature, and it is the only part of the
// server that pulls a third-party parser (node-ical) with its own engine
// requirements. Loading it eagerly once took the entire app down in
// production: on Node 18 node-ical throws a SyntaxError at module load
// (it uses the RegExp `v` flag, which is Node 20+), so `require` crashed
// before the server ever listened — a 502 crash loop for a feature almost
// nobody had switched on.
//
// The real fix is engines.node in package.json. This guard is the second
// layer: a broken or unloadable calendar module now costs you the calendar,
// not the board. `calendarError` is surfaced by the calendar routes.
let calendar;
let calendarError = null;
try {
  calendar = require('./calendar');
} catch (err) {
  calendarError = err;
  console.error('Calendar import disabled — failed to load ./calendar:', err.message);
  const off = () => { throw new Error('Calendar import is unavailable on this server'); };
  calendar = {
    maybeSyncInBackground: () => {},   // the tasks route calls this on every GET
    getFeed: () => null,               // "no feed connected", the honest answer
    deleteAllEvents: () => {},
    normalizeFeedUrl: off, syncFeed: off, maskUrl: off,
    fetchEvents: off, expandEvents: off, prunePastEvents: () => {},
    WINDOW_DAYS: 0, SYNC_INTERVAL_MS: 0,
  };
}

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy (Railway/Heroku/etc.) req.ip should be the real
// client address from X-Forwarded-For, not the proxy's.
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());

// Persist the database once per request (after the response is sent) instead
// of once per SQL statement — spillover/cascade paths can run dozens of
// statements per request, and each full-DB export is O(database size).
app.use((req, res, next) => {
  res.on('finish', flushDb);
  next();
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/help', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'help.html'));
});

// Static assets (wordmark font, any future images)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Utility: generate slug from name
function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15) || 'user';
}

// Utility: generate subdomain from company name
function generateSubdomain(name) {
  return name.toLowerCase()
    .replace(/['']s\s+move\s+along$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20) || 'team';
}

// Utility: generate initials from name
function generateInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Utility: get random color
function getRandomColor() {
  const colors = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1', '#f06292', '#aed581'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// A project's URL-safe slug, derived from its name. Shared by create and
// rename so the two can never drift apart.
function projectSlugFrom(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30) || 'project';
}

// "list ..." tasks get a different pane and a different prompt (see ai.js).
const LIST_TASK_RE = /^list\b/i;

// A subtask pane holds at most this many visible rows.
const MAX_SUBTASKS = 7;

// Day capacity: max pending tasks per (owner, project) per day.
const MAX_TASKS_PER_DAY = 10;

// ============================================
// "TODAY" IS A LOCAL QUESTION
// ============================================
// Day keys are calendar labels (YYYY-MM-DD), and arithmetic on them is
// UTC-anchored, which is correct — but *which* label is today depends on where
// the user is standing. Deriving it from the server's UTC clock rolled the
// board over to tomorrow at 6pm CST / 5pm PST, hours before the user's day
// ended. The browser sends its IANA zone on every request (x-tz); we validate
// it and ask Intl, falling back to UTC for anything that isn't a browser.
function todayInZone(timeZone) {
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD, which is exactly the key format.
      return new Date().toLocaleDateString('en-CA', { timeZone });
    } catch (e) { /* unknown zone — fall through to UTC */ }
  }
  return new Date().toISOString().split('T')[0];
}

// The caller's local date. Every request-scoped "what is today" goes through
// here, so spillover, deadline flags and the board can't disagree.
function todayKeyFor(req) {
  const tz = req && req.get && req.get('x-tz');
  return todayInZone(typeof tz === 'string' && tz.length <= 64 ? tz : null);
}

// Add N days to a YYYY-MM-DD string, returning a new YYYY-MM-DD string. UTC-safe.
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// Add N months to a YYYY-MM-DD string, clamping to the end of the target
// month. Jan 31 + 1 month is Feb 28 (or Feb 29), never Mar 3 — setUTCMonth
// alone would overflow into the following month. UTC-safe.
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().split('T')[0];
}

// ============================================
// REPEATING TASKS
// ============================================
// A repeat is a rule on the task row itself (tasks.repeat_rule), not a
// separate schedule table — so deleting the task ends the repeat with no
// invisible state left behind. Only ever ONE instance of a repeating task
// exists on the board: completing it spawns the next. Missing an occurrence
// therefore can't pile up copies; the single instance just spills forward
// like any other task, which is what the whole app already does.
const REPEAT_RULES = ['daily', 'weekly', 'monthly'];

// The date the next instance is due, measured from the completed instance's
// own scheduled_date (not today) so a rhythm doesn't drift when you tick
// something late.
function nextRepeatDate(dateStr, rule) {
  if (rule === 'daily') return addDays(dateStr, 1);
  if (rule === 'weekly') return addDays(dateStr, 7);
  if (rule === 'monthly') return addMonths(dateStr, 1);
  return null;
}

// Create the next instance of a repeating task. Called after the current one
// is marked complete. The new row deliberately carries NO parent_task_id: the
// completing task has already been spliced out of any series it was in, and a
// fresh instance is a free-standing task, not a series member.
function spawnNextRepeat(task) {
  const requested = nextRepeatDate(task.scheduled_date, task.repeat_rule);
  if (!requested) return;

  // A repeat must not be able to blow the 10/day cap, so it overflows forward
  // exactly like a hand-typed task would.
  let effectiveDate;
  try {
    effectiveDate = findDayWithCapacity({
      ownerId: task.owner_id,
      projectId: task.project_id ?? null,
      requestedDate: requested,
    });
  } catch (err) {
    console.error('Repeat spawn: no day with capacity:', err);
    return;
  }

  // origin_date is the new instance's own date — each occurrence starts its
  // own day count rather than inheriting the previous one's age.
  runSql(`
    INSERT INTO tasks (company_id, owner_id, project_id, description, scheduled_date, origin_date, locked, priority, repeat_rule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    task.company_id,
    task.owner_id,
    task.project_id ?? null,
    task.description,
    effectiveDate,
    requested,
    task.locked ? 1 : 0,
    parseInt(task.priority, 10) || 0,
    task.repeat_rule,
  ]);
}

// Find the first date >= requestedDate where (ownerId, projectId) holds fewer
// than MAX_TASKS_PER_DAY pending tasks. The bucket is per-(owner, project);
// project_id IS NULL is its own bucket. Searches up to 365 days forward.
function findDayWithCapacity({ ownerId, projectId, requestedDate }) {
  const hasProject = projectId !== null && projectId !== undefined;
  const sql = hasProject
    ? 'SELECT COUNT(*) as cnt FROM tasks WHERE owner_id = ? AND scheduled_date = ? AND completed = 0 AND project_id = ?'
    : 'SELECT COUNT(*) as cnt FROM tasks WHERE owner_id = ? AND scheduled_date = ? AND completed = 0 AND project_id IS NULL';

  let date = requestedDate;
  for (let i = 0; i < 365; i++) {
    const params = hasProject ? [ownerId, date, projectId] : [ownerId, date];
    const row = queryOne(sql, params);
    if (row.cnt < MAX_TASKS_PER_DAY) return date;
    date = addDays(date, 1);
  }
  throw new Error('No day with capacity within search horizon');
}

// ============================================
// SERIES (TASK CHAIN) HELPERS
// ============================================
// Tasks form linear series via tasks.parent_task_id (each task points at its
// predecessor). Linking enforces a single successor per task, so a chain is a
// simple linked list: A <- B <- C.

// Days from a to b (positive when b is later). UTC-safe.
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00.000Z') - Date.parse(a + 'T00:00:00.000Z')) / 86400000);
}

function getChainChild(taskId) {
  return queryOne('SELECT * FROM tasks WHERE parent_task_id = ?', [taskId]);
}

// All successors of a task in series order (nearest first). Cycle-safe.
function getChainSuccessors(taskId) {
  const out = [];
  const seen = new Set([Number(taskId)]);
  let cur = getChainChild(taskId);
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    cur = getChainChild(cur.id);
  }
  return out;
}

// After a series member moves by deltaDays, its successors move by the same
// amount. The cascade stops at the first locked successor (deadlines never
// drift); completed successors are frozen in place but don't stop the chain.
function cascadeChainSuccessors(taskId, deltaDays) {
  if (!deltaDays) return;
  const now = new Date().toISOString();
  for (const succ of getChainSuccessors(taskId)) {
    if (succ.locked) break;
    if (succ.completed) continue;
    runSql('UPDATE tasks SET scheduled_date = ?, updated_at = ? WHERE id = ?',
      [addDays(succ.scheduled_date, deltaDays), now, succ.id]);
  }
}

// Remove a task from its series without breaking it: the task's successor
// re-links to the task's predecessor. Used when a task is re-dropped
// elsewhere, assigned away, or deleted.
function spliceOutOfChain(task) {
  const now = new Date().toISOString();
  const child = getChainChild(task.id);
  if (child) {
    runSql('UPDATE tasks SET parent_task_id = ?, updated_at = ? WHERE id = ?',
      [task.parent_task_id || null, now, child.id]);
  }
  if (task.parent_task_id) {
    runSql('UPDATE tasks SET parent_task_id = NULL, updated_at = ? WHERE id = ?', [now, task.id]);
  }
}

// ============================================
// COMPANY ROUTES
// ============================================

// Create a new company + first user (signup)
app.post('/api/companies', (req, res) => {
  const { companyName, userName } = req.body;

  if (!companyName || !userName) {
    return res.status(400).json({ error: 'companyName and userName are required' });
  }

  const subdomain = generateSubdomain(companyName);
  const userSlug = generateSlug(userName);

  // Sign in or sign up. This endpoint used to 409 on an existing team name,
  // which made it impossible to get back to an account after signing out —
  // the header form is the only way in, and it always posted here. There is no
  // authentication in MoveAlong (any board is reachable by URL), so matching an
  // existing team + user name signs you back into that account rather than
  // failing. A known name is the credential; that is the product's model.
  const existing = queryOne(
    'SELECT id, name, subdomain FROM companies WHERE subdomain = ?', [subdomain]);
  if (existing) {
    const user = queryOne(
      'SELECT id, name, slug, initials, color FROM users WHERE company_id = ? AND slug = ?',
      [existing.id, userSlug]);

    if (user) {
      return res.json({
        company: { id: existing.id, name: existing.name, subdomain },
        user,
        returning: true
      });
    }

    // Team exists but this person is new to it — add them and carry on.
    // getRandomColor() must be called once: calling it again for the response
    // would hand the client a different colour than the row actually holds.
    const initials = generateInitials(userName);
    const color = getRandomColor();
    try {
      const added = runSql(
        'INSERT INTO users (company_id, name, slug, initials, color) VALUES (?, ?, ?, ?, ?)',
        [existing.id, userName, userSlug, initials, color]
      );
      return res.status(201).json({
        company: { id: existing.id, name: existing.name, subdomain },
        user: { id: added.lastInsertRowid, name: userName, slug: userSlug, initials, color },
        returning: true
      });
    } catch (err) {
      console.error('Error adding user to existing company:', err);
      return res.status(500).json({ error: 'Failed to join team' });
    }
  }

  const userInitials = generateInitials(userName);
  const userColor = '#9575cd'; // First user gets purple

  try {
    const companyResult = runSql(
      'INSERT INTO companies (name, subdomain) VALUES (?, ?)',
      [companyName, subdomain]
    );

    const companyId = companyResult.lastInsertRowid;

    const userResult = runSql(
      'INSERT INTO users (company_id, name, slug, initials, color) VALUES (?, ?, ?, ?, ?)',
      [companyId, userName, userSlug, userInitials, userColor]
    );

    res.status(201).json({
      company: {
        id: companyId,
        name: companyName,
        subdomain
      },
      user: {
        id: userResult.lastInsertRowid,
        name: userName,
        slug: userSlug,
        initials: userInitials,
        color: userColor
      }
    });
  } catch (err) {
    console.error('Error creating company:', err);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

// Get company by subdomain
app.get('/api/companies/:subdomain', (req, res) => {
  const { subdomain } = req.params;

  const company = queryOne(
    'SELECT id, name, subdomain, created_at FROM companies WHERE subdomain = ?',
    [subdomain]
  );

  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  res.json(company);
});

// ============================================
// USER ROUTES
// ============================================

// Get all users for a company
app.get('/api/companies/:subdomain/users', (req, res) => {
  const { subdomain } = req.params;

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  const users = queryAll(
    'SELECT id, name, slug, initials, color, created_at FROM users WHERE company_id = ?',
    [company.id]
  );

  res.json(users);
});

// Get user by slug (for loading their board)
app.get('/api/companies/:subdomain/users/:slug', (req, res) => {
  const { subdomain, slug } = req.params;

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  const user = queryOne(
    'SELECT id, name, slug, initials, color, created_at FROM users WHERE company_id = ? AND slug = ?',
    [company.id, slug]
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});

// Create a new user (when assigning task to new person)
app.post('/api/companies/:subdomain/users', (req, res) => {
  const { subdomain } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  let slug = generateSlug(name);
  const initials = generateInitials(name);
  const color = getRandomColor();

  // Check for duplicate slug within company, append number if needed
  const existingSlugs = queryAll(
    'SELECT slug FROM users WHERE company_id = ? AND slug LIKE ?',
    [company.id, slug + '%']
  ).map(u => u.slug);

  if (existingSlugs.includes(slug)) {
    let counter = 2;
    while (existingSlugs.includes(slug + counter)) {
      counter++;
    }
    slug = slug + counter;
  }

  try {
    const result = runSql(
      'INSERT INTO users (company_id, name, slug, initials, color) VALUES (?, ?, ?, ?, ?)',
      [company.id, name, slug, initials, color]
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      slug,
      initials,
      color
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ============================================
// PROJECT ROUTES
// ============================================

// Create a project
app.post('/api/companies/:subdomain/users/:slug/projects', (req, res) => {
  const { subdomain, slug } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const projectSlug = projectSlugFrom(name);

  // Check for duplicate slug within company
  const existing = queryOne('SELECT id FROM projects WHERE company_id = ? AND slug = ?', [company.id, projectSlug]);
  if (existing) {
    return res.status(409).json({ error: 'A project with this name already exists' });
  }

  try {
    const result = runSql(
      'INSERT INTO projects (company_id, name, slug, created_by) VALUES (?, ?, ?, ?)',
      [company.id, name, projectSlug, user.id]
    );

    const projectId = result.lastInsertRowid;

    // Add creator as first member
    runSql('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [projectId, user.id]);

    res.status(201).json({
      id: projectId,
      name,
      slug: projectSlug,
      created_by: user.id,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// List projects for a user
app.get('/api/companies/:subdomain/users/:slug/projects', (req, res) => {
  const { subdomain, slug } = req.params;

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // due_today: locked (deadline) tasks of this user that are due today or
  // already past their lock date. Drives the red border on off-screen
  // project tabs, so a deadline on another board can't go unnoticed.
  const today = todayKeyFor(req);
  const projects = queryAll(`
    SELECT p.id, p.name, p.slug, p.created_by, p.created_at,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.project_id = p.id
               AND t.owner_id = ?
               AND t.locked = 1
               AND t.completed = 0
               AND t.scheduled_date <= ?) AS due_today
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ?
    ORDER BY CASE WHEN pm.position IS NULL THEN 1 ELSE 0 END, pm.position, p.created_at
  `, [user.id, today, user.id]);

  res.json(projects);
});

// Remove a board from this user. Deletion is PER-USER, matching how tab order
// and membership already work: it drops the caller's membership and their own
// tasks on that board, and never touches another member's copy.
//
// The project row itself is only destroyed once the last member leaves —
// otherwise abandoned rows would pile up invisibly. Note that tasks.project_id
// is ON DELETE SET NULL, so tasks MUST be deleted explicitly here; letting the
// FK fire would orphan them to project_id = NULL, where no view can reach them
// and nothing can ever clean them up.
app.delete('/api/companies/:subdomain/users/:slug/projects/:projectId', (req, res) => {
  const { subdomain, slug, projectId } = req.params;
  const id = parseInt(projectId);

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const membership = queryOne(
    `SELECT p.id, p.name FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
      WHERE p.id = ? AND p.company_id = ? AND pm.user_id = ?`,
    [id, company.id, user.id]);
  if (!membership) return res.status(404).json({ error: 'Project not found' });

  // A user with zero boards lands in an empty state the app offers no way out
  // of — there is no "new board" button any more, only the + in the header,
  // which needs a board to render beside. So the last one can't be removed.
  const mineCount = queryOne(
    'SELECT COUNT(*) AS n FROM project_members WHERE user_id = ?', [user.id]).n;
  if (mineCount <= 1) {
    return res.status(409).json({ error: "That's your only board — create another one first" });
  }

  try {
    const myTasks = queryAll(
      'SELECT id FROM tasks WHERE project_id = ? AND owner_id = ?', [id, user.id]);
    for (const t of myTasks) {
      runSql('DELETE FROM subtasks WHERE task_id = ?', [t.id]);
    }
    runSql('DELETE FROM tasks WHERE project_id = ? AND owner_id = ?', [id, user.id]);
    runSql('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [id, user.id]);

    // Last one out turns off the lights.
    const left = queryOne(
      'SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?', [id]).n;
    if (left === 0) {
      runSql('DELETE FROM tasks WHERE project_id = ?', [id]);
      runSql('DELETE FROM projects WHERE id = ?', [id]);
    }

    res.json({
      removed: id,
      name: membership.name,
      tasks_deleted: myTasks.length,
      project_destroyed: left === 0
    });
  } catch (err) {
    console.error('Error removing project:', err);
    res.status(500).json({ error: 'Failed to remove project' });
  }
});

// Reorder a user's project tabs. Order is per-user (stored on
// project_members), so one member dragging tabs never reorders anyone
// else's bar.
// Manual task order within one day of one board.
//
// Mirrors PUT .../projects/order deliberately: take the whole list, keep only
// ids the caller actually owns on that day, dedupe, and append anything that
// wasn't sent — so a partial or hostile list can never drop a task off the
// board. A day holds at most MAX_TASKS_PER_DAY pending tasks, so rewriting the
// entire day's order on every change is cheaper than maintaining sparse indices
// and cannot drift out of step.
//
// Calendar rows are excluded: they are force-sorted above everything by
// event_start, so a position among them would never be read.
app.put('/api/companies/:subdomain/users/:slug/tasks/order', (req, res) => {
  const { subdomain, slug } = req.params;
  const { task_ids, scheduled_date, project_id } = req.body;

  if (!Array.isArray(task_ids)) {
    return res.status(400).json({ error: 'task_ids array is required' });
  }
  if (!scheduled_date) {
    return res.status(400).json({ error: 'scheduled_date is required' });
  }

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const hasProject = project_id !== null && project_id !== undefined;

  try {
    // Assigning a task hands over owner_id outright, so owner_id = ? already
    // excludes anything given away — there is no assigned-away row to skip.
    const owned = queryAll(
      `SELECT id FROM tasks
       WHERE owner_id = ? AND scheduled_date = ? AND completed = 0
         AND source != 'calendar'
         AND ${hasProject ? 'project_id = ?' : 'project_id IS NULL'}
       ORDER BY CASE WHEN position IS NULL THEN 1 ELSE 0 END, position, created_at`,
      hasProject ? [user.id, scheduled_date, project_id] : [user.id, scheduled_date]
    );
    const ownedIds = owned.map(t => t.id);

    const seen = new Set();
    const ordered = [];
    task_ids.forEach(raw => {
      const id = parseInt(raw, 10);
      if (ownedIds.includes(id) && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    });
    ownedIds.forEach(id => { if (!seen.has(id)) ordered.push(id); });

    ordered.forEach((id, i) => runSql('UPDATE tasks SET position = ? WHERE id = ?', [i, id]));
    res.json({ task_ids: ordered });
  } catch (err) {
    console.error('Error reordering tasks:', err);
    res.status(500).json({ error: 'Failed to reorder tasks' });
  }
});

app.put('/api/companies/:subdomain/users/:slug/projects/order', (req, res) => {
  const { subdomain, slug } = req.params;
  const { project_ids } = req.body;

  if (!Array.isArray(project_ids)) {
    return res.status(400).json({ error: 'project_ids array is required' });
  }

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    // Only projects this user actually belongs to can be positioned.
    const mine = queryAll(`
      SELECT p.id
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ?
      ORDER BY CASE WHEN pm.position IS NULL THEN 1 ELSE 0 END, pm.position, p.created_at
    `, [user.id]).map(r => r.id);
    const mineSet = new Set(mine);

    const seen = new Set();
    const ordered = [];
    for (const raw of project_ids) {
      const id = parseInt(raw);
      if (mineSet.has(id) && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    // Anything the client left out keeps its relative order at the end.
    for (const id of mine) {
      if (!seen.has(id)) ordered.push(id);
    }

    ordered.forEach((id, index) => {
      runSql('UPDATE project_members SET position = ? WHERE project_id = ? AND user_id = ?',
        [index, id, user.id]);
    });

    res.json({ project_ids: ordered });
  } catch (err) {
    console.error('Error reordering projects:', err);
    res.status(500).json({ error: 'Failed to reorder projects' });
  }
});

// Rename a board. The slug is regenerated from the new name: nothing in the
// app addresses a project by slug (there is no URL routing — the frontend
// keys everything off project_id in localStorage), so a stale slug would only
// ever drift away from the name for no benefit.
//
// MUST stay declared after PUT .../projects/order — Express matches routes in
// declaration order, so a :projectId param above it would swallow "order".
app.put('/api/companies/:subdomain/users/:slug/projects/:projectId', (req, res) => {
  const { subdomain, slug, projectId } = req.params;
  const { name } = req.body;
  const id = parseInt(projectId);

  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'name is required' });

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Only a member can rename the board — same membership check delete uses.
  const membership = queryOne(
    `SELECT p.id FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
      WHERE p.id = ? AND p.company_id = ? AND pm.user_id = ?`,
    [id, company.id, user.id]);
  if (!membership) return res.status(404).json({ error: 'Project not found' });

  const newSlug = projectSlugFrom(trimmed);

  // slug is UNIQUE per company, so a rename can collide exactly like a create.
  const clash = queryOne(
    'SELECT id FROM projects WHERE company_id = ? AND slug = ? AND id != ?',
    [company.id, newSlug, id]);
  if (clash) return res.status(409).json({ error: 'A project with this name already exists' });

  try {
    runSql('UPDATE projects SET name = ?, slug = ? WHERE id = ?', [trimmed, newSlug, id]);
    res.json({ id, name: trimmed, slug: newSlug });
  } catch (err) {
    console.error('Error renaming project:', err);
    res.status(500).json({ error: 'Failed to rename project' });
  }
});

// Add a member to a project
app.post('/api/companies/:subdomain/projects/:projectSlug/members', (req, res) => {
  const { subdomain, projectSlug } = req.params;
  const { user_id } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const project = queryOne('SELECT id FROM projects WHERE company_id = ? AND slug = ?', [company.id, projectSlug]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Check if already a member
  const existing = queryOne('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, user_id]);
  if (existing) return res.json({ success: true, message: 'Already a member' });

  try {
    runSql('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [project.id, user_id]);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Error adding project member:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// ============================================
// TASK ROUTES
// ============================================

// Get all tasks for a user
app.get('/api/companies/:subdomain/users/:slug/tasks', (req, res) => {
  const { subdomain, slug } = req.params;

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  const user = queryOne(
    'SELECT id FROM users WHERE company_id = ? AND slug = ?',
    [company.id, slug]
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Spillover: incomplete past tasks move to today. Series members keep
  // their spacing: an overdue member spills to today and drags its
  // successors forward by the same delta (stopping at locked members).
  const today = todayKeyFor(req);
  // Calendar rows never spill. An event that has passed is pruned by the sync,
  // not carried forward — a meeting happened whether or not you ticked it off.
  // This check and the `fresh.source` one below are the ONLY thing keeping
  // yesterday's standup off today, so both must stay in step.
  let overdueSql = `
    SELECT * FROM tasks
    WHERE owner_id = ?
      AND completed = 0
      AND locked = 0
      AND COALESCE(source, 'user') != 'calendar'
      AND scheduled_date < ?
  `;
  const overdueParams = [user.id, today];
  if (req.query.project_id) {
    overdueSql += ' AND project_id = ?';
    overdueParams.push(parseInt(req.query.project_id));
  }
  overdueSql += ' ORDER BY scheduled_date';

  // A cascade can leave later chain members still overdue; loop until stable.
  for (let pass = 0; pass < 50; pass++) {
    const overdue = queryAll(overdueSql, overdueParams);
    let changed = false;
    for (const t of overdue) {
      // An earlier cascade this pass may have already moved this task.
      const fresh = queryOne('SELECT * FROM tasks WHERE id = ?', [t.id]);
      if (!fresh || fresh.completed || fresh.locked || fresh.scheduled_date >= today) continue;
      if (fresh.source === 'calendar') continue;
      const delta = daysBetween(fresh.scheduled_date, today);
      runSql('UPDATE tasks SET scheduled_date = ?, updated_at = ? WHERE id = ?',
        [today, new Date().toISOString(), fresh.id]);
      cascadeChainSuccessors(fresh.id, delta);
      changed = true;
    }
    if (!changed) break;
  }

  let taskSql = `
    SELECT
      t.id,
      t.description,
      t.scheduled_date,
      t.origin_date,
      t.parent_task_id,
      t.promoted_from,
      t.locked,
      t.priority,
      t.position,
      t.repeat_rule,
      t.source,
      t.event_start,
      t.external_uid,
      t.completed,
      t.completed_at,
      t.assigned_by,
      t.project_id,
      t.created_at,
      t.updated_at,
      u.name as assigned_by_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_by = u.id
    WHERE t.owner_id = ?
  `;
  const taskParams = [user.id];
  if (req.query.project_id) {
    // Calendar rows are stored with project_id = NULL on purpose: one row then
    // shows on every board, since your 2pm dentist appointment constrains
    // whatever board you happen to be looking at. This is the only place that
    // NULL is meaningful — do not "repair" those rows to a project.
    taskSql += " AND (t.project_id = ? OR t.source = 'calendar')";
    taskParams.push(parseInt(req.query.project_id));
  }
  taskSql += ' ORDER BY t.scheduled_date, t.created_at';

  const tasks = queryAll(taskSql, taskParams);

  // Fire-and-forget: serve what we have, refresh in the background if the feed
  // is stale. There is no scheduler in this server, and awaiting a remote fetch
  // would put network latency on the board's hot path.
  calendar.maybeSyncInBackground(user.id, today);

  res.json(tasks);
});

// Create a new task
app.post('/api/companies/:subdomain/users/:slug/tasks', (req, res) => {
  const { subdomain, slug } = req.params;
  const { description, scheduled_date, project_id } = req.body;

  if (!description || !scheduled_date) {
    return res.status(400).json({ error: 'description and scheduled_date are required' });
  }

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  const user = queryOne(
    'SELECT id FROM users WHERE company_id = ? AND slug = ?',
    [company.id, slug]
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  let effectiveDate;
  try {
    effectiveDate = findDayWithCapacity({
      ownerId: user.id,
      projectId: project_id ?? null,
      requestedDate: scheduled_date,
    });
  } catch (err) {
    console.error('Capacity helper failed:', err);
    return res.status(500).json({ error: 'Failed to schedule task' });
  }

  try {
    // origin_date is the requested day, not the effective one — if the day
    // was full and the task overflowed forward, that bump counts as a push.
    const result = runSql(
      'INSERT INTO tasks (company_id, owner_id, project_id, description, scheduled_date, origin_date) VALUES (?, ?, ?, ?, ?, ?)',
      [company.id, user.id, project_id || null, description, effectiveDate, scheduled_date]
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      description,
      scheduled_date: effectiveDate,
      origin_date: scheduled_date,
      requested_date: scheduled_date,
      project_id: project_id || null,
      locked: 0,
      priority: 0,
      completed: 0,
      assigned_by: null,
      assigned_by_name: null
    });
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update a task (complete, move date, etc.)
app.put('/api/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { scheduled_date, completed, locked, priority, repeat_rule } = req.body;

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const updates = [];
  const values = [];

  if (scheduled_date !== undefined) {
    updates.push('scheduled_date = ?');
    values.push(scheduled_date);
  }

  // A calendar row must never carry `locked`: that flag drives board
  // anchoring, red project tabs and red task text, so an imported event
  // holding it would misfire all three every day. Refused server-side too,
  // not just hidden in the UI.
  if (locked !== undefined && task.source !== 'calendar') {
    updates.push('locked = ?');
    values.push(locked ? 1 : 0);
  }

  // Priority: 0 = none, 1-3 exclamation marks. Clamped so a bad client can't
  // write an out-of-range level that the board would then fail to render.
  // Retained so old clients don't 400, but nothing reads it any more: manual
  // position replaced the priority ranking on 2026-08-14.
  if (priority !== undefined) {
    const level = Math.min(9, Math.max(0, parseInt(priority, 10) || 0));
    updates.push('priority = ?');
    values.push(level);
  }

  // Repeat: null (one-off) or one of REPEAT_RULES. Refused on calendar rows —
  // an imported event is already regenerated by the feed, so a second
  // regeneration source would duplicate it every time you ticked one. Same
  // guard shape as `locked` above: the UI hides it, but the server refuses it.
  if (repeat_rule !== undefined && task.source !== 'calendar') {
    const rule = REPEAT_RULES.includes(repeat_rule) ? repeat_rule : null;
    updates.push('repeat_rule = ?');
    values.push(rule);
  }

  if (completed !== undefined) {
    updates.push('completed = ?');
    values.push(completed ? 1 : 0);
    updates.push('completed_at = ?');
    values.push(completed ? new Date().toISOString() : null);
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());

  values.push(taskId);

  try {
    runSql(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);

    // Series cascade: moving a member drags its successors by the same delta.
    if (scheduled_date !== undefined && scheduled_date !== task.scheduled_date) {
      cascadeChainSuccessors(task.id, daysBetween(task.scheduled_date, scheduled_date));
    }

    // Completing a task severs its series links: its child re-links to its
    // parent and the completed task stands alone. One-way — reopening the
    // task does not restore the links.
    if (completed !== undefined && completed && !task.completed) {
      spliceOutOfChain(task);

      // Completing a repeating task is what creates the next one. Runs after
      // the splice so the fresh instance is free-standing, and reads the rule
      // off the pre-update row (this same request may have just set it).
      if (task.repeat_rule) {
        spawnNextRepeat(task);
      }
    }

    const updated = queryOne(`
      SELECT
        t.id,
        t.description,
        t.scheduled_date,
        t.origin_date,
        t.parent_task_id,
        t.locked,
        t.priority,
      t.position,
        t.repeat_rule,
        t.completed,
        t.completed_at,
        t.assigned_by,
        t.project_id,
        t.created_at,
        t.updated_at,
        u.name as assigned_by_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_by = u.id
      WHERE t.id = ?
    `, [taskId]);

    res.json(updated);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Link a task into a series: it becomes the step right after the task it was
// dropped on, and moves to that task's day + 1 (origin_date untouched). If
// the drop target already had a successor, the dragged task splices between
// them. Re-dropping an already-chained task repositions it.
app.post('/api/tasks/:taskId/link', (req, res) => {
  const { taskId } = req.params;
  const { parent_task_id } = req.body;

  if (!parent_task_id) {
    return res.status(400).json({ error: 'parent_task_id is required' });
  }
  if (Number(parent_task_id) === Number(taskId)) {
    return res.status(400).json({ error: 'Cannot link a task to itself' });
  }

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const parent = queryOne('SELECT * FROM tasks WHERE id = ?', [parent_task_id]);
  if (!parent) return res.status(404).json({ error: 'Parent task not found' });

  if (task.owner_id !== parent.owner_id) {
    return res.status(400).json({ error: 'Tasks must belong to the same owner' });
  }
  if ((task.project_id || null) !== (parent.project_id || null)) {
    return res.status(400).json({ error: 'Tasks must belong to the same project' });
  }
  if (task.completed || parent.completed) {
    return res.status(400).json({ error: 'Completed tasks cannot be linked' });
  }

  try {
    // Detach first so ancestor→descendant drops become simple repositioning.
    spliceOutOfChain(task);

    // Cycle guard (defense against pre-existing bad links): walking up from
    // the parent must never reach the task being linked.
    let cur = parent;
    let hops = 0;
    while (cur && cur.parent_task_id && hops++ < 1000) {
      if (Number(cur.parent_task_id) === Number(taskId)) {
        return res.status(400).json({ error: 'Link would create a cycle' });
      }
      cur = queryOne('SELECT id, parent_task_id FROM tasks WHERE id = ?', [cur.parent_task_id]);
    }

    const now = new Date().toISOString();

    // The parent's existing successor now follows the dragged task instead.
    const existing = queryOne(
      'SELECT id FROM tasks WHERE parent_task_id = ? AND id != ?',
      [parent.id, task.id]
    );
    if (existing) {
      runSql('UPDATE tasks SET parent_task_id = ?, updated_at = ? WHERE id = ?',
        [task.id, now, existing.id]);
    }

    runSql('UPDATE tasks SET parent_task_id = ?, scheduled_date = ?, updated_at = ? WHERE id = ?',
      [parent.id, addDays(parent.scheduled_date, 1), now, task.id]);

    const updated = queryOne(`
      SELECT
        t.id,
        t.description,
        t.scheduled_date,
        t.origin_date,
        t.parent_task_id,
        t.locked,
        t.priority,
      t.position,
        t.repeat_rule,
        t.completed,
        t.completed_at,
        t.assigned_by,
        t.project_id,
        t.created_at,
        t.updated_at,
        u.name as assigned_by_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_by = u.id
      WHERE t.id = ?
    `, [taskId]);

    res.json(updated);
  } catch (err) {
    console.error('Error linking task:', err);
    res.status(500).json({ error: 'Failed to link task' });
  }
});

// Cut the link between a task and its predecessor only — unlike
// spliceOutOfChain (used on delete/assign, which bypasses the whole task),
// this leaves the task's own successors attached: the task becomes the new
// root of a separate series instead of disappearing from the chain.
app.post('/api/tasks/:taskId/unlink', (req, res) => {
  const { taskId } = req.params;

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.parent_task_id) {
    return res.status(400).json({ error: 'Task has no predecessor to unlink' });
  }

  try {
    runSql('UPDATE tasks SET parent_task_id = NULL, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), taskId]);

    const updated = queryOne(`
      SELECT
        t.id,
        t.description,
        t.scheduled_date,
        t.origin_date,
        t.parent_task_id,
        t.locked,
        t.priority,
      t.position,
        t.repeat_rule,
        t.completed,
        t.completed_at,
        t.assigned_by,
        t.project_id,
        t.created_at,
        t.updated_at,
        u.name as assigned_by_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_by = u.id
      WHERE t.id = ?
    `, [taskId]);

    res.json(updated);
  } catch (err) {
    console.error('Error unlinking task:', err);
    res.status(500).json({ error: 'Failed to unlink task' });
  }
});

// Assign task to another user
app.post('/api/tasks/:taskId/assign', (req, res) => {
  const { taskId } = req.params;
  const { to_user_id, scheduled_date } = req.body;

  if (!to_user_id || !scheduled_date) {
    return res.status(400).json({ error: 'to_user_id and scheduled_date are required' });
  }

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const toUser = queryOne('SELECT id FROM users WHERE id = ?', [to_user_id]);
  if (!toUser) {
    return res.status(404).json({ error: 'Target user not found' });
  }

  try {
    // Assigning moves the task to another board — it leaves its series.
    spliceOutOfChain(task);

    runSql(`
      UPDATE tasks
      SET owner_id = ?, assigned_by = ?, scheduled_date = ?, locked = 0, repeat_rule = NULL, updated_at = ?
      WHERE id = ?
    `, [to_user_id, task.owner_id, scheduled_date, new Date().toISOString(), taskId]);

    const updated = queryOne(`
      SELECT 
        t.id,
        t.description,
        t.scheduled_date,
        t.origin_date,
        t.completed,
        t.completed_at,
        t.assigned_by,
        t.owner_id,
        t.created_at,
        t.updated_at,
        u.name as assigned_by_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_by = u.id
      WHERE t.id = ?
    `, [taskId]);

    res.json(updated);
  } catch (err) {
    console.error('Error assigning task:', err);
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

// Return task to sender
app.post('/api/tasks/:taskId/return', (req, res) => {
  const { taskId } = req.params;
  const { scheduled_date } = req.body;

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (!task.assigned_by) {
    return res.status(400).json({ error: 'Task was not assigned, cannot return' });
  }

  const currentOwnerId = task.owner_id;
  const originalAssignerId = task.assigned_by;

  try {
    runSql(`
      UPDATE tasks
      SET owner_id = ?, assigned_by = ?, scheduled_date = ?, locked = 0, repeat_rule = NULL, updated_at = ?
      WHERE id = ?
    `, [originalAssignerId, currentOwnerId, scheduled_date || task.scheduled_date, new Date().toISOString(), taskId]);

    const updated = queryOne(`
      SELECT 
        t.id,
        t.description,
        t.scheduled_date,
        t.origin_date,
        t.completed,
        t.completed_at,
        t.assigned_by,
        t.owner_id,
        t.created_at,
        t.updated_at,
        u.name as assigned_by_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_by = u.id
      WHERE t.id = ?
    `, [taskId]);

    res.json(updated);
  } catch (err) {
    console.error('Error returning task:', err);
    res.status(500).json({ error: 'Failed to return task' });
  }
});

// Delete a task
app.delete('/api/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  try {
    // Keep the series intact: successor re-links to predecessor.
    spliceOutOfChain(task);
    runSql('DELETE FROM tasks WHERE id = ?', [taskId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ============================================
// SUBTASK ROUTES
// ============================================

// A board's AI budget and what it has spent this month.
app.get('/api/projects/:projectId/budget', (req, res) => {
  const { projectId } = req.params;
  const project = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  res.json({
    month: monthKey(),
    budget_usd: budgetUsd(projectId),
    spent_usd: monthSpendUsd(projectId),
    research_enabled: researchEnabled(projectId)
  });
});

// Whole dollars only — a cents-level budget control is a decision the app is
// supposed to be saving people from.
app.put('/api/projects/:projectId/budget', (req, res) => {
  const { projectId } = req.params;

  const project = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (req.body.budget_usd !== undefined) {
    const budget = parseInt(req.body.budget_usd, 10);
    if (!Number.isFinite(budget) || budget < 0 || budget > 1000) {
      return res.status(400).json({ error: 'budget_usd must be a whole number of dollars, 0-1000' });
    }
    runSql('UPDATE projects SET ai_budget_usd = ? WHERE id = ?', [budget, projectId]);
  }

  if (req.body.research_enabled !== undefined) {
    runSql('UPDATE projects SET research_enabled = ? WHERE id = ?',
      [req.body.research_enabled ? 1 : 0, projectId]);
  }

  res.json({
    month: monthKey(),
    budget_usd: budgetUsd(projectId),
    spent_usd: monthSpendUsd(projectId),
    research_enabled: researchEnabled(projectId)
  });
});

// Get subtasks for a task
app.get('/api/tasks/:taskId/subtasks', (req, res) => {
  const { taskId } = req.params;

  const task = queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const subtasks = queryAll(`
    SELECT id, task_id, parent_subtask_id, description, assignee_type,
           assigned_to, assigned_by, sort_order, provisional, researched, completed, completed_at,
           created_at, updated_at
    FROM subtasks
    WHERE task_id = ?
    ORDER BY sort_order, created_at
  `, [taskId]);

  res.json(subtasks);
});

// Create a subtask
app.post('/api/tasks/:taskId/subtasks', (req, res) => {
  const { taskId } = req.params;
  const { description, assignee_type, parent_subtask_id, sort_order } = req.body;

  if (!description) return res.status(400).json({ error: 'description is required' });

  const task = queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Auto-calculate sort_order if not provided
  let order = sort_order;
  if (order === undefined) {
    const maxOrder = queryOne('SELECT MAX(sort_order) as max_order FROM subtasks WHERE task_id = ?', [taskId]);
    order = (maxOrder && maxOrder.max_order !== null) ? maxOrder.max_order + 1 : 0;
  }

  try {
    const result = runSql(
      `INSERT INTO subtasks (task_id, parent_subtask_id, description, assignee_type, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [taskId, parent_subtask_id || null, description, assignee_type || 'human', order]
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      task_id: parseInt(taskId),
      parent_subtask_id: parent_subtask_id || null,
      description,
      assignee_type: assignee_type || 'human',
      assigned_to: null,
      assigned_by: null,
      sort_order: order,
      completed: 0,
      completed_at: null
    });
  } catch (err) {
    console.error('Error creating subtask:', err);
    res.status(500).json({ error: 'Failed to create subtask' });
  }
});

// Bulk create subtasks (for AI generation)
app.post('/api/tasks/:taskId/subtasks/bulk', (req, res) => {
  const { taskId } = req.params;
  const { subtasks: subtaskList } = req.body;

  if (!Array.isArray(subtaskList)) return res.status(400).json({ error: 'subtasks array is required' });

  const task = queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  try {
    const created = [];
    subtaskList.forEach((st, i) => {
      const result = runSql(
        `INSERT INTO subtasks (task_id, parent_subtask_id, description, assignee_type, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [taskId, st.parent_subtask_id || null, st.description, st.assignee_type || 'human', st.sort_order !== undefined ? st.sort_order : i]
      );
      created.push({
        id: result.lastInsertRowid,
        task_id: parseInt(taskId),
        parent_subtask_id: st.parent_subtask_id || null,
        description: st.description,
        assignee_type: st.assignee_type || 'human',
        assigned_to: null,
        assigned_by: null,
        sort_order: st.sort_order !== undefined ? st.sort_order : i,
        completed: 0,
        completed_at: null
      });
    });

    res.status(201).json(created);
  } catch (err) {
    console.error('Error bulk creating subtasks:', err);
    res.status(500).json({ error: 'Failed to create subtasks' });
  }
});

// Update a subtask
app.put('/api/subtasks/:subtaskId', (req, res) => {
  const { subtaskId } = req.params;
  const { description, completed, assignee_type, sort_order } = req.body;

  const subtask = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  const updates = [];
  const values = [];

  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (assignee_type !== undefined) { updates.push('assignee_type = ?'); values.push(assignee_type); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }
  if (completed !== undefined) {
    updates.push('completed = ?');
    values.push(completed ? 1 : 0);
    updates.push('completed_at = ?');
    values.push(completed ? new Date().toISOString() : null);
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(subtaskId);

  try {
    runSql(`UPDATE subtasks SET ${updates.join(', ')} WHERE id = ?`, values);
    const updated = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
    res.json(updated);
  } catch (err) {
    console.error('Error updating subtask:', err);
    res.status(500).json({ error: 'Failed to update subtask' });
  }
});

// Delete a subtask
app.delete('/api/subtasks/:subtaskId', (req, res) => {
  const { subtaskId } = req.params;

  const subtask = queryOne('SELECT id FROM subtasks WHERE id = ?', [subtaskId]);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  try {
    runSql('DELETE FROM subtasks WHERE id = ?', [subtaskId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting subtask:', err);
    res.status(500).json({ error: 'Failed to delete subtask' });
  }
});

// Splice a task in immediately after another on the same day and renumber that
// day densely. Positions are otherwise only written by PUT .../tasks/order —
// this is the one other site, and it uses the same ordering so the two agree.
function placeTaskAfter(taskId, afterTaskId, ownerId, projectId, date) {
  const hasProject = projectId !== null && projectId !== undefined;
  const day = queryAll(
    `SELECT id FROM tasks
     WHERE owner_id = ? AND scheduled_date = ? AND completed = 0
       AND source != 'calendar'
       AND ${hasProject ? 'project_id = ?' : 'project_id IS NULL'}
     ORDER BY CASE WHEN position IS NULL THEN 1 ELSE 0 END, position, created_at`,
    hasProject ? [ownerId, date, projectId] : [ownerId, date]
  ).map(t => t.id);

  const rest = day.filter(id => id !== taskId);
  const at = rest.indexOf(afterTaskId);
  if (at === -1) return;
  rest.splice(at + 1, 0, taskId);
  rest.forEach((id, i) => runSql('UPDATE tasks SET position = ? WHERE id = ?', [i, id]));
}

// Promote a subtask onto the board as a real task.
// It lands on the PARENT TASK's day, not today: the pane may be hanging under
// next Tuesday because that is when the user is planning to do this. The row is
// then deleted — it is a task now, and its departure is what frees a slot in
// the pane's 7.
app.post('/api/subtasks/:subtaskId/promote', (req, res) => {
  const { subtaskId } = req.params;

  const subtask = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [subtask.task_id]);
  if (!task) return res.status(404).json({ error: 'Parent task not found' });

  try {
    const date = findDayWithCapacity({
      ownerId: task.owner_id,
      projectId: task.project_id,
      requestedDate: task.scheduled_date
    });

    const result = runSql(
      `INSERT INTO tasks (company_id, owner_id, project_id, description, scheduled_date, origin_date, promoted_from)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [task.company_id, task.owner_id, task.project_id, subtask.description, date, date, task.id]
    );

    // Sit it directly under the task it came out of. Only possible when the
    // day had room for it — an overflow lands on a different card entirely,
    // where there is nothing to sit under, so it just appends there.
    if (date === task.scheduled_date) {
      placeTaskAfter(result.lastInsertRowid, task.id, task.owner_id, task.project_id, date);
    }

    // Dependents would be orphaned pointing at a row that no longer exists;
    // ON DELETE CASCADE removes them, so lift them up to this row's parent first.
    runSql('UPDATE subtasks SET parent_subtask_id = ? WHERE parent_subtask_id = ?',
      [subtask.parent_subtask_id || null, subtaskId]);
    runSql('DELETE FROM subtasks WHERE id = ?', [subtaskId]);

    res.status(201).json({
      task: queryOne('SELECT * FROM tasks WHERE id = ?', [result.lastInsertRowid]),
      scheduled_date: date
    });
  } catch (err) {
    console.error('Error promoting subtask:', err);
    res.status(500).json({ error: 'Failed to promote subtask' });
  }
});

// Research a whole task's steps on demand — the pane's "Research these steps"
// button. With auto-research off by default, this is the main way phase 2 runs.
app.post('/api/tasks/:taskId/research', async (req, res) => {
  const { taskId } = req.params;

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!aiKeyAllows(req) || !aiBudgetAllows(req.ip)) {
    return res.status(403).json({ error: 'AI is not available on this board' });
  }
  if (!researchAllowed(task.project_id)) {
    return res.status(402).json({
      error: 'over_budget',
      spent: monthSpendUsd(task.project_id),
      budget: budgetUsd(task.project_id)
    });
  }

  // runResearch works off the provisional flag, so flag what needs doing first:
  // every pending row that has not already been researched.
  const pending = queryAll(
    'SELECT id FROM subtasks WHERE task_id = ? AND completed = 0 AND researched = 0',
    [taskId]
  );
  if (!pending.length) return res.status(200).json({ started: false, reason: 'nothing to research' });

  runSql('UPDATE subtasks SET provisional = 1 WHERE task_id = ? AND completed = 0 AND researched = 0', [taskId]);
  runSql(`UPDATE tasks SET research_status = 'running' WHERE id = ?`, [taskId]);

  res.status(202).json({ started: true, count: pending.length });
  runResearch(taskId).catch(err => console.error('Research dispatch failed:', err.message));
});

// Research one subtask on demand — what the → arrow on an AI row now does.
// Same machinery as the whole-task pass, scoped to a single row.
app.post('/api/subtasks/:subtaskId/research', async (req, res) => {
  const { subtaskId } = req.params;

  const subtask = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [subtask.task_id]);
  if (!task) return res.status(404).json({ error: 'Parent task not found' });

  if (!aiKeyAllows(req) || !aiBudgetAllows(req.ip)) {
    return res.status(403).json({ error: 'AI is not available on this board' });
  }
  if (!researchAllowed(task.project_id)) {
    return res.status(402).json({
      error: 'over_budget',
      spent: monthSpendUsd(task.project_id),
      budget: budgetUsd(task.project_id)
    });
  }

  try {
    const ai = require('./ai');
    const results = await ai.researchSubtasks(task.description, [subtask.description], {
      location: locationForUser(task.owner_id),
      kind: LIST_TASK_RE.test(task.description || '') ? 'item' : 'step'
    });
    recordUsage(task.project_id, subtask.task_id, 'research', ai.takeUsage());

    const r = results[0];
    const live = queryOne('SELECT id FROM subtasks WHERE id = ?', [subtaskId]);
    if (!live) return res.status(404).json({ error: 'Subtask no longer exists' });

    const replace = r.illogical && r.replacement && r.confidence >= RESEARCH_REPLACE_CONFIDENCE;
    runSql('UPDATE subtasks SET description = ?, provisional = 0, researched = 1, updated_at = ? WHERE id = ?',
      [replace ? r.replacement : r.refined, new Date().toISOString(), subtaskId]);

    res.json(queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]));
  } catch (err) {
    console.error('Error researching subtask:', err);
    res.status(500).json({ error: 'Research failed' });
  }
});

// Assign a subtask to a user
app.post('/api/subtasks/:subtaskId/assign', (req, res) => {
  const { subtaskId } = req.params;
  const { to_user_id, scheduled_date } = req.body;

  if (!to_user_id || !scheduled_date) {
    return res.status(400).json({ error: 'to_user_id and scheduled_date are required' });
  }

  const subtask = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [subtask.task_id]);
  if (!task) return res.status(404).json({ error: 'Parent task not found' });

  try {
    // Mark subtask as assigned
    runSql(`UPDATE subtasks SET assigned_to = ?, assigned_by = ?, updated_at = ? WHERE id = ?`,
      [to_user_id, task.owner_id, new Date().toISOString(), subtaskId]);

    // Create a task on the assignee's board
    const newTask = runSql(
      'INSERT INTO tasks (company_id, owner_id, project_id, assigned_by, description, scheduled_date, origin_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [task.company_id, to_user_id, task.project_id, task.owner_id, subtask.description, scheduled_date, scheduled_date]
    );

    // Auto-add assignee to project if not already a member
    if (task.project_id) {
      const isMember = queryOne('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [task.project_id, to_user_id]);
      if (!isMember) {
        runSql('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [task.project_id, to_user_id]);
      }
    }

    // Also assign dependent subtasks
    const dependents = queryAll('SELECT id FROM subtasks WHERE parent_subtask_id = ? AND assigned_to IS NULL', [subtaskId]);
    dependents.forEach(dep => {
      runSql(`UPDATE subtasks SET assigned_to = ?, assigned_by = ?, updated_at = ? WHERE id = ?`,
        [to_user_id, task.owner_id, new Date().toISOString(), dep.id]);
    });

    const updated = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
    res.json(updated);
  } catch (err) {
    console.error('Error assigning subtask:', err);
    res.status(500).json({ error: 'Failed to assign subtask' });
  }
});

// Return a subtask
app.post('/api/subtasks/:subtaskId/return', (req, res) => {
  const { subtaskId } = req.params;

  const subtask = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });
  if (!subtask.assigned_by) return res.status(400).json({ error: 'Subtask was not assigned' });

  try {
    const today = todayKeyFor(req);
    runSql(`UPDATE subtasks SET assigned_to = NULL, assigned_by = NULL, updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), subtaskId]);

    const updated = queryOne('SELECT * FROM subtasks WHERE id = ?', [subtaskId]);
    res.json(updated);
  } catch (err) {
    console.error('Error returning subtask:', err);
    res.status(500).json({ error: 'Failed to return subtask' });
  }
});

// ============================================
// AI SUBTASK GENERATION
// ============================================

// Generate subtasks for a task (mock or AI)
// AI spend protection, two layers:
//  1. AI_ACCESS_KEY (optional): when set, only requests whose x-ai-key
//     header matches get real AI — everyone else gets mock subtasks, so
//     strangers can never spend the owner's Anthropic credit. Unset, any
//     visitor may trigger AI (rate-limited below) — fine for private
//     deployments, risky for public URLs.
//  2. Per-IP hourly and global daily caps; over either cap we quietly
//     serve mock subtasks instead (no API spend, no error).
const AI_ACCESS_KEY = process.env.AI_ACCESS_KEY || '';

// ============================================================
// AI SPEND — per-board monthly budget
// ============================================================
// Two different limits guard AI spend and they are not interchangeable:
// AI_LIMIT_* below are abuse brakes on a public deployment (per IP, per day),
// while this budget is the board owner's own dollar cap on RESEARCH. Phase 1
// subtask generation is never blocked by the budget — a task the user just
// typed must always come back with something — so an exhausted board still
// drafts steps, it just stops researching them and says so.
const DEFAULT_BUDGET_USD = 5;
// Replace a drafted step only when the model is genuinely sure it is wrong.
// The user is already looking at that row; swapping it out on a hunch is worse
// than leaving a merely-vague step in place.
const RESEARCH_REPLACE_CONFIDENCE = 0.8;

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function budgetUsd(projectId) {
  const row = queryOne('SELECT ai_budget_usd FROM projects WHERE id = ?', [projectId]);
  return row && row.ai_budget_usd != null ? row.ai_budget_usd : DEFAULT_BUDGET_USD;
}

function monthSpendUsd(projectId) {
  const row = queryOne(
    'SELECT SUM(cost_usd) AS total FROM ai_usage WHERE project_id = ? AND month = ?',
    [projectId, monthKey()]
  );
  return (row && row.total) || 0;
}

function recordUsage(projectId, taskId, kind, usage) {
  if (!usage) return;
  runSql(
    `INSERT INTO ai_usage (project_id, task_id, month, kind, model, input_tokens, output_tokens, web_searches, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId || null, taskId || null, monthKey(), kind, usage.model || null,
     usage.input_tokens || 0, usage.output_tokens || 0, usage.web_searches || 0, usage.cost_usd || 0]
  );
}

function researchEnabled(projectId) {
  const row = queryOne('SELECT research_enabled FROM projects WHERE id = ?', [projectId]);
  return !!(row && row.research_enabled);
}

// Research is billed to a board. Calendar rows carry project_id = NULL and so
// have nothing to bill; they are never researched.
function researchAllowed(projectId) {
  if (projectId == null) return false;
  return monthSpendUsd(projectId) < budgetUsd(projectId);
}

// web_search takes an approximate user_location. The only location this app
// knows is the IANA zone captured when a calendar feed was connected, which is
// enough to localize "stores near me" without asking for an address.
function locationForUser(userId) {
  const feed = queryOne('SELECT timezone FROM calendar_feeds WHERE user_id = ?', [userId]);
  return feed && feed.timezone ? { timezone: feed.timezone } : null;
}

// Phase 2. Fire-and-forget: rewrites this task's provisional rows in place with
// researched text and clears the flag. Never adds, removes or reorders rows —
// each result is matched back by index to the row it came from, and any row the
// user ticked or promoted meanwhile is re-checked and skipped.
async function runResearch(taskId) {
  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return;

  const rows = queryAll(
    'SELECT id, description FROM subtasks WHERE task_id = ? AND provisional = 1 AND completed = 0 ORDER BY sort_order, id',
    [taskId]
  );
  if (!rows.length) return;

  runSql(`UPDATE tasks SET research_status = 'running' WHERE id = ?`, [taskId]);
  flushDb();

  try {
    const ai = require('./ai');
    const results = await ai.researchSubtasks(
      task.description,
      rows.map(r => r.description),
      { location: locationForUser(task.owner_id), kind: LIST_TASK_RE.test(task.description || '') ? 'item' : 'step' }
    );
    recordUsage(task.project_id, taskId, 'research', ai.takeUsage());

    const now = new Date().toISOString();
    results.forEach((r, i) => {
      const row = rows[i];
      // Re-read: the search took a while, and the user may have ticked this row
      // off or promoted it to the board while we were out.
      const live = queryOne('SELECT id FROM subtasks WHERE id = ? AND provisional = 1 AND completed = 0', [row.id]);
      if (!live) return;
      const replace = r.illogical && r.replacement && r.confidence >= RESEARCH_REPLACE_CONFIDENCE;
      runSql('UPDATE subtasks SET description = ?, provisional = 0, researched = 1, updated_at = ? WHERE id = ?',
        [replace ? r.replacement : r.refined, now, row.id]);
    });

    runSql(`UPDATE tasks SET research_status = 'done' WHERE id = ?`, [taskId]);
  } catch (err) {
    console.error(`Research failed for task ${taskId}:`, err.message);
    // Clear the flag on failure or the rows stay greyed forever and the
    // frontend keeps polling for a result that is never coming.
    runSql('UPDATE subtasks SET provisional = 0 WHERE task_id = ? AND provisional = 1', [taskId]);
    runSql(`UPDATE tasks SET research_status = 'failed' WHERE id = ?`, [taskId]);
  }

  // Same trap as the calendar sync: res.on('finish', flushDb) already fired for
  // the request that started this, so these writes have nothing scheduled to
  // persist them.
  flushDb();
}

function aiKeyAllows(req) {
  if (!AI_ACCESS_KEY) return true;
  const given = Buffer.from(String(req.get('x-ai-key') || ''));
  const expected = Buffer.from(AI_ACCESS_KEY);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const AI_LIMIT_PER_IP_HOUR = parseInt(process.env.AI_LIMIT_PER_IP_HOUR || '20', 10);
const AI_LIMIT_GLOBAL_DAY = parseInt(process.env.AI_LIMIT_GLOBAL_DAY || '200', 10);
const aiCallsByIp = new Map(); // ip -> timestamps (ms) within the last hour
let aiCallsToday = { day: '', count: 0 };

function aiBudgetAllows(ip) {
  const now = Date.now();
  const recent = (aiCallsByIp.get(ip) || []).filter(t => t > now - 3600 * 1000);
  aiCallsByIp.set(ip, recent);
  const today = new Date().toISOString().slice(0, 10);
  if (aiCallsToday.day !== today) aiCallsToday = { day: today, count: 0 };
  if (recent.length >= AI_LIMIT_PER_IP_HOUR || aiCallsToday.count >= AI_LIMIT_GLOBAL_DAY) {
    return false;
  }
  recent.push(now);
  aiCallsToday.count++;
  return true;
}

app.post('/api/tasks/:taskId/generate-subtasks', async (req, res) => {
  const { taskId } = req.params;

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const isListTask = LIST_TASK_RE.test(task.description || '');

  const fullSet = () => queryAll(`
    SELECT id, task_id, parent_subtask_id, description, assignee_type,
           assigned_to, assigned_by, sort_order, provisional, researched, completed, completed_at,
           created_at, updated_at
    FROM subtasks WHERE task_id = ?
    ORDER BY sort_order, created_at
  `, [taskId]);

  // Regenerating TOPS UP an ordinary pane instead of wiping it: every pending
  // row the user kept survives, and only the empty slots are refilled, so the
  // visible total never exceeds MAX_SUBTASKS. Ticking a step off is what buys a
  // fresh suggestion — which is also the only way to free a slot, since there is
  // deliberately no delete affordance on a subtask row.
  // A list pane is different: "My list" and "Suggestions" are separate sections,
  // so capping the two together would starve suggestions. Its AI rows are still
  // replaced wholesale and the user's own items still survive.
  let need = MAX_SUBTASKS;
  let kept = [];
  let startOrder = 0;

  if (isListTask) {
    runSql(`DELETE FROM subtasks WHERE task_id = ? AND assignee_type = 'ai'`, [taskId]);
  } else {
    kept = queryAll(
      'SELECT description, sort_order FROM subtasks WHERE task_id = ? AND completed = 0 ORDER BY sort_order, id',
      [taskId]
    );
    need = MAX_SUBTASKS - kept.length;
    if (need <= 0) return res.status(200).json({ subtasks: fullSet(), research_status: task.research_status, full: true });
  }

  const maxOrder = queryOne('SELECT MAX(sort_order) AS m FROM subtasks WHERE task_id = ?', [taskId]);
  startOrder = (maxOrder && maxOrder.m != null) ? maxOrder.m + 1 : 0;

  try {
    let subtaskList;
    let usedRealAi = false;

    // Try AI generation if available (and the caller is allowed to spend)
    try {
      if (!aiKeyAllows(req)) {
        console.warn(`AI access key missing/invalid (ip: ${req.ip}) — serving mock subtasks`);
        subtaskList = generateMockSubtasks(task.description);
      } else if (!aiBudgetAllows(req.ip)) {
        console.warn(`AI rate limit hit (ip: ${req.ip}) — serving mock subtasks`);
        subtaskList = generateMockSubtasks(task.description);
      } else {
        const ai = require('./ai');
        subtaskList = await ai.generateSubtasks(task.description, {
          count: need,
          existing: kept.map(k => k.description)
        });
        usedRealAi = true;
        recordUsage(task.project_id, taskId, 'draft', ai.takeUsage());
      }
    } catch (e) {
      // Fall back to mock
      console.error('AI subtask generation failed, falling back to mock:', e.message);
      subtaskList = generateMockSubtasks(task.description);
      usedRealAi = false;
    }

    subtaskList = subtaskList.slice(0, need);
    if (isListTask) {
      subtaskList = subtaskList.map(st => ({ description: st.description, assignee_type: 'ai' }));
    }

    // Research is opt-in per board and NEVER fires on a regenerate: topping up
    // one row costs a full search budget, so ↺ would be the most expensive habit
    // in the app. Adding a task on a research-enabled board is the only automatic
    // trigger; everything else goes through the pane's Research button or →.
    const isRegenerate = req.body && req.body.regenerate === true;
    const wants = usedRealAi && !isRegenerate && researchEnabled(task.project_id);
    const overBudget = wants && !researchAllowed(task.project_id);
    const willResearch = wants && !overBudget;

    subtaskList.forEach((st, i) => {
      runSql(
        `INSERT INTO subtasks (task_id, parent_subtask_id, description, assignee_type, sort_order, provisional)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [taskId, st.parent_subtask_id || null, st.description, st.assignee_type || 'human',
         startOrder + i, willResearch ? 1 : 0]
      );
    });

    const status = overBudget ? 'over_budget' : (willResearch ? 'running' : null);
    runSql('UPDATE tasks SET research_status = ? WHERE id = ?', [status, taskId]);

    res.status(201).json({ subtasks: fullSet(), research_status: status });

    // Phase 2 runs behind the response — the user already has something to read.
    if (willResearch) {
      runResearch(taskId).catch(err => console.error('Research dispatch failed:', err.message));
    }
  } catch (err) {
    console.error('Error generating subtasks:', err);
    res.status(500).json({ error: 'Failed to generate subtasks' });
  }
});

function generateMockSubtasks(description) {
  const desc = description.toLowerCase();

  // --- "list ..." tasks: placeholder suggestions ---
  if (/^list\b/i.test(description)) {
    return [
      'A popular option to consider',
      'One people often forget',
      'A crowd-pleaser',
      'A hidden gem worth checking out',
      'A budget-friendly option',
      'An ambitious stretch',
      'A wildcard'
    ].map(d => ({ description: d, assignee_type: 'ai' }));
  }

  // --- Build / birdhouse / woodworking ---
  if (desc.includes('birdhouse') || desc.includes('bird house')) {
    return [
      { description: 'Pick a spot — sunny, 5-10 ft high, near trees (audubon.org/news/how-build-birdhouse)', assignee_type: 'ai' },
      { description: 'Choose target birds for your area (audubon.org/bird-guide)', assignee_type: 'ai' },
      { description: 'Decision: buy plans online ($5-15 on etsy.com/search?q=birdhouse+plans) vs design your own', assignee_type: 'human' },
      { description: 'Get materials — cedar boards, galvanized screws, waterproof glue (homedepot.com/s/cedar%20boards)', assignee_type: 'human' },
      { description: 'Research: entry hole size by species — 1.5" for wrens, 1.25" for chickadees (nestwatch.org/learn/all-about-birdhouses/)', assignee_type: 'ai' },
      { description: 'Cut pieces to size — front, back, sides, floor, roof', assignee_type: 'human' },
      { description: 'Drill entry hole and ventilation holes', assignee_type: 'human' },
      { description: 'Assemble with screws (not nails) — add hinged roof for cleaning', assignee_type: 'human' },
      { description: 'Finish: leave natural or use non-toxic exterior stain (no paint inside)', assignee_type: 'human' },
      { description: 'Mount and add predator guard (amazon.com/s?k=birdhouse+predator+guard)', assignee_type: 'human' }
    ];
  }

  // --- Buy / purchase / shop ---
  if (desc.includes('buy') || desc.includes('purchase') || desc.includes('shop')) {
    const item = desc.replace(/^(buy|purchase|shop for|shop|get)\s+(a\s+|an\s+|some\s+|the\s+)?/i, '').trim() || 'item';
    return [
      { description: `Research: top-rated ${item} — compare features & prices (amazon.com/s?k=${encodeURIComponent(item)})`, assignee_type: 'ai' },
      { description: `Check reviews & ratings on Wirecutter (nytimes.com/wirecutter/search/?s=${encodeURIComponent(item)})`, assignee_type: 'ai' },
      { description: `Compare prices across retailers (google.com/search?tbm=shop&q=${encodeURIComponent(item)})`, assignee_type: 'ai' },
      { description: 'Decision: set your max budget', assignee_type: 'human' },
      { description: 'Decision: buy online (delivery in 1-2 days) vs buy in-store today', assignee_type: 'human' },
      { description: `Make the purchase — pick the best option from research above`, assignee_type: 'human' }
    ];
  }

  // --- Plan party / event ---
  if (desc.includes('party') || desc.includes('birthday') || desc.includes('celebration')) {
    return [
      { description: 'Pick a date and time — check key guests\' availability', assignee_type: 'human' },
      { description: 'Decision: venue — home, restaurant, park, or rental (peerspace.com)', assignee_type: 'human' },
      { description: 'Research: catering options near you (thumbtack.com/k/catering/near-me)', assignee_type: 'ai' },
      { description: 'Decision: cook yourself vs cater vs potluck — get price quotes', assignee_type: 'human' },
      { description: 'Create guest list and send invites (partiful.com or evite.com)', assignee_type: 'human' },
      { description: 'Research: theme & decoration ideas (pinterest.com/search/pins/?q=party+decorations)', assignee_type: 'ai' },
      { description: 'Order decorations — balloons, banners, tableware (amazon.com/s?k=party+supplies)', assignee_type: 'human' },
      { description: 'Plan activities or entertainment (spotify.com/playlist for music)', assignee_type: 'human' },
      { description: 'Research: cake or dessert options — bakeries near you (yelp.com/search?find_desc=bakery)', assignee_type: 'ai' },
      { description: 'Day-of checklist: setup, ice, drinks, music, camera', assignee_type: 'human' }
    ];
  }

  // --- Plan / organize (generic) ---
  if (desc.includes('plan') || desc.includes('organize')) {
    return [
      { description: 'Define what "done" looks like — write 2-3 success criteria', assignee_type: 'human' },
      { description: 'Research: how others have done this (reddit.com, relevant guides)', assignee_type: 'ai' },
      { description: 'List all people who need to be involved and their roles', assignee_type: 'human' },
      { description: 'Set a deadline and work backwards to create milestones', assignee_type: 'human' },
      { description: 'Identify the biggest risk — what could go wrong?', assignee_type: 'human' },
      { description: 'Decision: budget — how much are you willing to spend?', assignee_type: 'human' },
      { description: 'Book or reserve anything time-sensitive now', assignee_type: 'human' }
    ];
  }

  // --- Travel / trip / vacation ---
  if (desc.includes('trip') || desc.includes('travel') || desc.includes('vacation') || desc.includes('flight')) {
    const dest = desc.replace(/^(plan|book|take)\s+(a\s+)?(trip|vacation|flight)\s+(to\s+)?/i, '').trim() || 'destination';
    return [
      { description: `Research: flights to ${dest} (google.com/travel/flights?q=${encodeURIComponent(dest)})`, assignee_type: 'ai' },
      { description: `Research: hotels & Airbnbs (airbnb.com/s/${encodeURIComponent(dest)})`, assignee_type: 'ai' },
      { description: `Check weather forecast for travel dates (weather.com)`, assignee_type: 'ai' },
      { description: 'Decision: set total trip budget (flights + lodging + activities)', assignee_type: 'human' },
      { description: 'Book flights — use price comparison from research', assignee_type: 'human' },
      { description: 'Book accommodation — pick from top 3 options', assignee_type: 'human' },
      { description: `Research: top things to do in ${dest} (tripadvisor.com/Search?q=${encodeURIComponent(dest)})`, assignee_type: 'ai' },
      { description: 'Make a day-by-day itinerary', assignee_type: 'human' },
      { description: 'Check passport/visa requirements if international', assignee_type: 'ai' },
      { description: 'Packing list — weather-appropriate clothes, chargers, documents', assignee_type: 'human' }
    ];
  }

  // --- Build / create / make (generic) ---
  if (desc.includes('build') || desc.includes('create') || desc.includes('make')) {
    const thing = desc.replace(/^(build|create|make)\s+(a\s+)?/i, '').trim() || 'project';
    return [
      { description: `Research: ${thing} guides & tutorials (youtube.com/results?search_query=how+to+build+${encodeURIComponent(thing)})`, assignee_type: 'ai' },
      { description: `Decision: DIY vs buy a kit vs hire someone (thumbtack.com)`, assignee_type: 'human' },
      { description: `Research: materials list & costs (homedepot.com/s/${encodeURIComponent(thing)})`, assignee_type: 'ai' },
      { description: 'Decision: set your budget and timeline', assignee_type: 'human' },
      { description: 'Get tools and materials — check what you already own', assignee_type: 'human' },
      { description: 'Follow the plan — build step by step', assignee_type: 'human' },
      { description: 'Test it out and fix any issues', assignee_type: 'human' }
    ];
  }

  // --- Move / relocate ---
  if (desc.includes('move') || desc.includes('relocate') || desc.includes('moving')) {
    return [
      { description: 'Decision: hire movers vs rent a truck vs DIY (uhaul.com, pods.com)', assignee_type: 'human' },
      { description: 'Research: moving company quotes near you (yelp.com/search?find_desc=movers)', assignee_type: 'ai' },
      { description: 'Start decluttering — donate, sell, or trash room by room', assignee_type: 'human' },
      { description: 'Get packing supplies — boxes, tape, bubble wrap (homedepot.com/s/moving%20boxes)', assignee_type: 'human' },
      { description: 'Update address: USPS, bank, subscriptions, DMV (usps.com/move)', assignee_type: 'human' },
      { description: 'Transfer or set up utilities at new place (electric, internet, water)', assignee_type: 'human' },
      { description: 'Pack room by room — label every box by room + contents', assignee_type: 'human' },
      { description: 'Schedule moving day and confirm logistics', assignee_type: 'human' }
    ];
  }

  // --- Generic fallback (still actionable) ---
  const thing = desc.trim() || 'this task';
  return [
    { description: `Research: how to approach "${thing}" — guides & examples (google.com/search?q=${encodeURIComponent('how to ' + thing)})`, assignee_type: 'ai' },
    { description: 'Write down what "done" looks like — 2-3 concrete outcomes', assignee_type: 'human' },
    { description: 'Decision: do it yourself vs delegate vs hire someone', assignee_type: 'human' },
    { description: 'Identify the first physical action you can take right now', assignee_type: 'human' },
    { description: 'Set a deadline — when does this need to be finished?', assignee_type: 'human' },
    { description: 'Do the work — start with the easiest step to build momentum', assignee_type: 'human' },
    { description: 'Review: did the outcome match your success criteria?', assignee_type: 'human' }
  ];
}

// ============================================
// MASTER PROJECT PAGE
// ============================================

// Get master view: all projects with open/unassigned tasks
app.get('/api/companies/:subdomain/users/:slug/master', (req, res) => {
  const { subdomain, slug } = req.params;

  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const projects = queryAll(`
    SELECT p.id, p.name, p.slug, p.created_by, p.created_at
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ?
    ORDER BY p.created_at
  `, [user.id]);

  const result = projects.map(project => {
    const tasks = queryAll(`
      SELECT t.id, t.description, t.scheduled_date, t.completed, t.assigned_by, t.priority, t.position, t.locked, t.repeat_rule,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) as subtask_count,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND completed = 1) as completed_subtask_count
      FROM tasks t
      WHERE t.project_id = ? AND t.owner_id = ? AND t.completed = 0
      ORDER BY t.scheduled_date,
               CASE WHEN t.position IS NULL THEN 1 ELSE 0 END, t.position,
               t.created_at
    `, [project.id, user.id]);

    return { ...project, tasks };
  });

  res.json({ projects: result });
});

// ============================================
// HEALTH CHECK
// ============================================

// ============================================
// CALENDAR FEED
// ============================================
// One subscribed iCal feed per user. The URL is a bearer credential for the
// whole calendar, so it is stored server-side and only ever returned masked.

function resolveCalendarUser(req, res) {
  const { subdomain, slug } = req.params;
  const company = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (!company) {
    res.status(404).json({ error: 'Company not found' });
    return null;
  }
  const user = queryOne('SELECT id FROM users WHERE company_id = ? AND slug = ?', [company.id, slug]);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return user;
}

function calendarStatus(userId) {
  const feed = calendar.getFeed(userId);
  if (!feed) return { connected: false, enabled: false };
  return {
    connected: true,
    enabled: !!feed.enabled,
    url_masked: calendar.maskUrl(feed.url),
    timezone: feed.timezone,
    last_synced_at: feed.last_synced_at,
    last_status: feed.last_status,
    last_error: feed.last_error,
    event_count: feed.event_count || 0,
    window_days: calendar.WINDOW_DAYS
  };
}

app.get('/api/companies/:subdomain/users/:slug/calendar', (req, res) => {
  const user = resolveCalendarUser(req, res);
  if (!user) return;
  res.json(calendarStatus(user.id));
});

// Connect a feed, change its URL, or flip it on/off.
app.put('/api/companies/:subdomain/users/:slug/calendar', async (req, res) => {
  const user = resolveCalendarUser(req, res);
  if (!user) return;

  const { url, timezone, enabled } = req.body || {};
  const existing = calendar.getFeed(user.id);
  const today = todayKeyFor(req);

  if (url !== undefined) {
    let normalized;
    try {
      normalized = calendar.normalizeFeedUrl(url);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const tz = timezone || (existing && existing.timezone) || 'UTC';
    if (existing) {
      runSql('UPDATE calendar_feeds SET url = ?, timezone = ?, enabled = 1 WHERE user_id = ?',
        [normalized, tz, user.id]);
      // A different calendar means the old calendar's events are no longer ours.
      if (existing.url !== normalized) calendar.deleteAllEvents(user.id);
    } else {
      runSql('INSERT INTO calendar_feeds (user_id, url, timezone, enabled) VALUES (?, ?, ?, 1)',
        [user.id, normalized, tz]);
    }
    // Connecting should show something immediately, so this one is awaited.
    const result = await calendar.syncFeed(user.id, today);
    if (result && result.error) {
      return res.status(400).json({ error: result.error, ...calendarStatus(user.id) });
    }
    return res.json(calendarStatus(user.id));
  }

  if (!existing) return res.status(404).json({ error: 'No calendar connected' });

  if (enabled !== undefined) {
    const on = enabled ? 1 : 0;
    runSql('UPDATE calendar_feeds SET enabled = ? WHERE user_id = ?', [on, user.id]);
    if (!on) {
      // Clear the board, but keep the URL so turning it back on costs no re-paste.
      calendar.deleteAllEvents(user.id);
    } else {
      const result = await calendar.syncFeed(user.id, today);
      if (result && result.error) {
        return res.status(400).json({ error: result.error, ...calendarStatus(user.id) });
      }
    }
  }

  if (timezone !== undefined) {
    runSql('UPDATE calendar_feeds SET timezone = ? WHERE user_id = ?', [timezone, user.id]);
  }

  res.json(calendarStatus(user.id));
});

app.post('/api/companies/:subdomain/users/:slug/calendar/sync', async (req, res) => {
  const user = resolveCalendarUser(req, res);
  if (!user) return;
  const feed = calendar.getFeed(user.id);
  if (!feed) return res.status(404).json({ error: 'No calendar connected' });

  // Force a sync regardless of the 15-minute throttle.
  runSql('UPDATE calendar_feeds SET last_synced_at = NULL WHERE user_id = ?', [user.id]);
  const result = await calendar.syncFeed(user.id, todayKeyFor(req));
  if (result && result.error) {
    return res.status(400).json({ error: result.error, ...calendarStatus(user.id) });
  }
  res.json({ ...calendarStatus(user.id), ...result });
});

app.delete('/api/companies/:subdomain/users/:slug/calendar', (req, res) => {
  const user = resolveCalendarUser(req, res);
  if (!user) return;
  calendar.deleteAllEvents(user.id);
  runSql('DELETE FROM calendar_feeds WHERE user_id = ?', [user.id]);
  res.json({ connected: false, enabled: false });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Boot repair: completed tasks must hold no chain links (invariant since
// completing began severing links). Data completed before that change can
// still carry parent_task_id or have children pointing at it — splice each
// out until clean, so old boards heal on deploy.
// A process restart mid-research leaves rows flagged provisional with nothing
// left running to clear them: they would render greyed forever and the frontend
// would poll for a result that died with the old process.
function repairInterruptedResearch() {
  const stuck = queryAll(`SELECT id FROM tasks WHERE research_status = 'running'`);
  if (!stuck.length) return;
  stuck.forEach(t => {
    runSql('UPDATE subtasks SET provisional = 0 WHERE task_id = ? AND provisional = 1', [t.id]);
    runSql(`UPDATE tasks SET research_status = 'failed' WHERE id = ?`, [t.id]);
  });
  console.log(`Cleared ${stuck.length} interrupted research job(s)`);
}

function repairCompletedChainLinks() {
  let total = 0;
  for (let pass = 0; pass < 25; pass++) {
    const linked = queryAll(`
      SELECT * FROM tasks
      WHERE completed = 1
        AND (parent_task_id IS NOT NULL
             OR id IN (SELECT parent_task_id FROM tasks WHERE parent_task_id IS NOT NULL))
    `);
    if (linked.length === 0) break;
    // Re-fetch each row right before splicing: an earlier splice in this
    // pass may have rewritten this task's parent_task_id (consecutive
    // completed members), and splicing from a stale row would re-link its
    // child to a task that is no longer in the chain.
    linked.forEach(t => {
      const fresh = queryOne('SELECT * FROM tasks WHERE id = ?', [t.id]);
      if (fresh) spliceOutOfChain(fresh);
    });
    total += linked.length;
  }
  if (total > 0) {
    console.log(`Chain repair: spliced ${total} completed task(s) out of series`);
    flushDb();
  }
}

// Initialize database and start server
initDb().then(() => {
  repairCompletedChainLinks();
  repairInterruptedResearch();
  app.listen(PORT, () => {
    console.log(`Move Along API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// Flush any unsaved writes on shutdown (Railway sends SIGTERM on deploys).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    flushDb();
    process.exit(0);
  });
}
