const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'movealong.db');

let db = null;

async function initDb() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // sql.js defaults foreign_keys off like stock SQLite; without this, every
  // ON DELETE CASCADE/SET NULL below is declared but never enforced.
  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subdomain TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      initials TEXT NOT NULL,
      color TEXT NOT NULL,
      role TEXT,
      share_board INTEGER DEFAULT 0,
      is_ai INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      UNIQUE(company_id, slug)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      ai_budget_usd INTEGER DEFAULT 5,
      research_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(company_id, slug)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      position INTEGER,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(project_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      owner_id INTEGER NOT NULL,
      project_id INTEGER,
      assigned_by INTEGER,
      accepted_at DATETIME,
      return_when_done INTEGER DEFAULT 0,
      completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      background TEXT,
      results TEXT,
      description TEXT NOT NULL,
      scheduled_date DATE NOT NULL,
      origin_date DATE,
      parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      promoted_from INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      locked INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
      position INTEGER,
      repeat_rule TEXT,
      research_status TEXT,
      source TEXT DEFAULT 'user',
      external_uid TEXT,
      event_start TEXT,
      completed INTEGER DEFAULT 0,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      parent_subtask_id INTEGER,
      description TEXT NOT NULL,
      assignee_type TEXT DEFAULT 'human',
      assigned_to INTEGER,
      assigned_by INTEGER,
      assigned_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      sort_order INTEGER DEFAULT 0,
      provisional INTEGER DEFAULT 0,
      researched INTEGER DEFAULT 0,
      cost_kind TEXT,
      cost_low REAL,
      cost_high REAL,
      cost_unit TEXT,
      cost_basis TEXT,
      cost_source_url TEXT,
      cost_confidence REAL,
      cost_as_of TEXT,
      completed INTEGER DEFAULT 0,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_subtask_id) REFERENCES subtasks(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Notes on a task's page (/task/:id): an append-only feed with attribution,
  // not one editable blob — several people (and later, agents) add to a task,
  // and "who said this, when" is the half of a note that a shared text area
  // silently destroys. author_id is nullable and SET NULL: a note outlives
  // its author, and with no auth the author is whoever the browser's session
  // says anyway.
  db.run(`
    CREATE TABLE IF NOT EXISTS task_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      author_id INTEGER,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // One subscribed calendar feed per user. The URL is a secret iCal address —
  // a bearer credential for the whole calendar — so it is never returned to
  // the client unmasked (see the calendar routes in server.js).
  db.run(`
    CREATE TABLE IF NOT EXISTS calendar_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      url TEXT NOT NULL,
      timezone TEXT,
      enabled INTEGER DEFAULT 1,
      last_synced_at DATETIME,
      last_status TEXT,
      last_error TEXT,
      event_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // One row per billed Anthropic call, so a board's monthly spend is an audit
  // trail rather than a bare counter — the first question anyone asks a budget
  // is "where did it go". `month` is a 'YYYY-MM' key so the monthly SUM is an
  // index hit rather than a date-range scan.
  db.run(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      task_id INTEGER,
      month TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      web_searches INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // The brief: standing notes the assistant reads before every AI call. Two
  // layers — a personal one that follows the user to every board, and one per
  // board — merged at call time. Freeform, one bullet per line; the model is
  // told to apply what matters to the task and ignore the rest.
  //
  // brief_questions is the assistant's inbox in reverse: a gap the model hit
  // while working ("Which airport do you fly from?"), waiting for a one-line
  // answer. brief_usage records which lines the model actually applied, keyed
  // by line text, so the page can show what has earned its place and what has
  // never been read. Both are what let the brief curate itself from the work
  // side instead of asking the user to sit down and write an essay.
  db.run(`
    CREATE TABLE IF NOT EXISTS brief_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER,
      task_id INTEGER,
      question TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS brief_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      line TEXT NOT NULL,
      uses INTEGER DEFAULT 0,
      last_used_at DATETIME,
      UNIQUE(scope, owner_id, line)
    )
  `);

  // Migrations for existing databases (ALTER TABLE is idempotent-guarded via table_info)
  ensureColumn('tasks', 'locked', 'INTEGER DEFAULT 0');
  ensureColumn('tasks', 'origin_date', 'DATE');
  // Series: a task points at its predecessor; NULL = not in a series.
  ensureColumn('tasks', 'parent_task_id', 'INTEGER REFERENCES tasks(id) ON DELETE SET NULL');
  // The task this row was promoted out of, as a subtask step. Purely a
  // display relation — it sits under its source on the board and shows a
  // dotted circle — so SET NULL on delete just drops the cue.
  ensureColumn('tasks', 'promoted_from', 'INTEGER REFERENCES tasks(id) ON DELETE SET NULL');
  // Priority: 0 = none, 1-3 = number of red exclamation marks (3 = most urgent).
  ensureColumn('tasks', 'priority', 'INTEGER DEFAULT 0');
  // Repeat: NULL = one-off, else 'daily' | 'weekly' | 'monthly'. Only ever one
  // instance of a repeating task exists — completing it spawns the next one.
  ensureColumn('tasks', 'repeat_rule', 'TEXT');
  // Per-user tab order for the project bar. NULL = never dragged; the
  // projects query falls back to creation order for those.
  ensureColumn('project_members', 'position', 'INTEGER');
  // Calendar import: rows with source='calendar' are mirrored from the user's
  // subscribed iCal feed. They are deliberately NOT locked — every deadline
  // behavior (board anchoring, red tabs, red text, the amber edge) gates on
  // `locked`, and locking events would misfire all of them daily. Spillover
  // exemption is instead an explicit source check in the tasks route.
  ensureColumn('tasks', 'source', "TEXT DEFAULT 'user'");
  // ICS UID plus the instance's date key: a recurring event's every instance
  // shares one UID, so UID alone is not unique.
  ensureColumn('tasks', 'external_uid', 'TEXT');
  // Local HH:MM, for the row's time chip and intra-day ordering.
  ensureColumn('tasks', 'event_start', 'TEXT');
  // Two-phase subtasks: phase 1 writes rows with provisional = 1 (rendered
  // greyed), the background research pass rewrites them in place and clears it.
  ensureColumn('subtasks', 'provisional', 'INTEGER DEFAULT 0');
  // NULL = never researched, else 'running' | 'done' | 'failed' | 'over_budget'.
  ensureColumn('tasks', 'research_status', 'TEXT');
  // Whole-dollar monthly cap on researched AI calls for this board.
  ensureColumn('projects', 'ai_budget_usd', 'INTEGER DEFAULT 5');
  // Auto-research on every new task. Default OFF: at ~$0.12 a task a $5 board
  // buys about 40 of them, which a board you throw things at all day burns in a
  // week. Research is opt-in per board, plus a button in the pane.
  ensureColumn('projects', 'research_enabled', 'INTEGER DEFAULT 0');
  // Manual ordering within a day. NULL = never positioned, and the sort puts
  // NULLs last, so a newly created task appends to the bottom of its day with
  // no INSERT site having to know this column exists.
  if (ensureColumn('tasks', 'position', 'INTEGER')) seedTaskPositions();
  // Marks a row the research pass actually rewrote, so the pane can show which
  // steps are real findings and which are still drafts.
  ensureColumn('subtasks', 'researched', 'INTEGER DEFAULT 0');
  // What the step costs in the real world. Deliberately NOT merged with the AI
  // budget: that is metered actuals from the API's own usage block, this is an
  // estimate about the world, and one number covering both would be a lie.
  // Written only by the research pass, and only above COST_MIN_CONFIDENCE.
  // kind is 'material' | 'labor' | 'service' | 'none' — most steps are 'none'
  // ("Decide: cook vs cater" costs nothing), which is what keeps the search
  // budget on the two or three rows that actually buy something.
  ensureColumn('subtasks', 'cost_kind', 'TEXT');
  // A range, never a point estimate — low === high would claim a precision
  // nothing here has.
  ensureColumn('subtasks', 'cost_low', 'REAL');
  ensureColumn('subtasks', 'cost_high', 'REAL');
  ensureColumn('subtasks', 'cost_unit', 'TEXT');
  // What was actually priced ("8x 1x6 cedar board, 6ft"). This is what makes an
  // estimate checkable instead of merely plausible, so it is not optional.
  ensureColumn('subtasks', 'cost_basis', 'TEXT');
  ensureColumn('subtasks', 'cost_source_url', 'TEXT');
  ensureColumn('subtasks', 'cost_confidence', 'REAL');
  // Prices move. A figure with no date is worse than no figure.
  ensureColumn('subtasks', 'cost_as_of', 'TEXT');
  // What this person does. Display only — nothing branches on it. It exists so
  // a shared board reads as "Margo, Accounting" rather than a bare first name,
  // which is the whole reason you would look at a teammate's week.
  ensureColumn('users', 'role', 'TEXT');
  // Has this person shared their board with the rest of the team. 0 by default,
  // and the shared-board route 403s without it — so "you cannot see someone
  // else's board unless they shared it" is enforced in the server, not merely
  // described in the copy.
  ensureColumn('users', 'share_board', 'INTEGER DEFAULT 0');
  // An AI teammate (Tessa). Renders with a 🧠 avatar, and work assigned to
  // her auto-accepts — an AI has no inbox to deliberate over, and making a
  // human click "accept" on the assistant's behalf would be an approval step
  // this app exists to delete. Real agent dispatch will hang off this flag.
  ensureColumn('users', 'is_ai', 'INTEGER DEFAULT 0');
  // When the recipient accepted an assigned task. NULL on a row that has an
  // assigner means it is still sitting in their inbox, neither accepted nor
  // returned — the one state the assignment flow never had. Backfilled on the
  // boot that adds it, so every task assigned before this shipped counts as
  // long since accepted rather than retroactively appearing unanswered.
  if (ensureColumn('tasks', 'accepted_at', 'DATETIME')) {
    db.run("UPDATE tasks SET accepted_at = updated_at WHERE assigned_by IS NOT NULL");
  }
  // Set by both assign routes: when the recipient completes this task, it
  // moves back to the sender's board as a finished row — the notification IS
  // the work landing home. Cleared by return (the episode is over; a returned
  // task completing afterwards stays put). Deliberately NOT backfilled: an
  // old row can't tell "work someone gave me" from "my work that came back"
  // (both carry assigned_by + accepted_at), and wrongly bouncing a returned
  // task onto its returner's board is worse than old handovers not reporting.
  ensureColumn('tasks', 'return_when_done', 'INTEGER DEFAULT 0');
  // Who actually did the work, once it came home. What lets the sender's row
  // read "done by Margo" and skip the strikethrough their own ticks get.
  ensureColumn('tasks', 'completed_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
  // The task page's two editable panes. Both live on the task row itself, so
  // when finished handed-over work moves home, the assignee's results ride
  // back to the sender with it — no copying step, the move IS the delivery.
  ensureColumn('tasks', 'background', 'TEXT');
  ensureColumn('tasks', 'results', 'TEXT');
  // The two brief layers (see brief_questions above).
  ensureColumn('users', 'brief', 'TEXT');
  ensureColumn('projects', 'brief', 'TEXT');
  // Three more personal sections (2026-09-02): the person's own contact
  // details, travel habits, and medical notes. Voluntary, freeform, and
  // sent to the model as labelled sections with an instruction never to copy
  // them into step text — a phone number in a subtask row would leak onto a
  // shared board.
  ensureColumn('users', 'brief_contact', 'TEXT');
  ensureColumn('users', 'brief_travel', 'TEXT');
  ensureColumn('users', 'brief_medical', 'TEXT');
  // The task created on the assignee's board when this step was handed over.
  // It is what lets the sender's pane say "Margo has it, not yet accepted"
  // without hunting for a task by matching description text.
  ensureColumn('subtasks', 'assigned_task_id', 'INTEGER REFERENCES tasks(id) ON DELETE SET NULL');

  // Pre-migration tasks never recorded their origin; the best available
  // approximation is wherever they sit now (their true origin is lost).
  db.run('UPDATE tasks SET origin_date = scheduled_date WHERE origin_date IS NULL');

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_users_slug ON users(company_id, slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(scheduled_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_companies_subdomain ON companies(subdomain)');
  db.run('CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(company_id, slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_subtask_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_external ON tasks(owner_id, external_uid)');
  db.run('CREATE INDEX IF NOT EXISTS idx_calendar_feeds_user ON calendar_feeds(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ai_usage_month ON ai_usage(project_id, month)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by)');
  db.run('CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id)');

  saveDb();
  return db;
}

// One-shot backfill, run only on the boot that adds tasks.position: give every
// existing day the order its owner currently SEES, so replacing the priority
// ranking with manual ordering doesn't reshuffle anyone's board on deploy.
// Priority DESC then created_at is exactly what the old sort did.
function seedTaskPositions() {
  const rows = queryAll(`
    SELECT id, owner_id, project_id, scheduled_date
    FROM tasks
    WHERE completed = 0
    ORDER BY owner_id, project_id, scheduled_date, priority DESC, created_at
  `);
  const seen = new Map();
  rows.forEach(r => {
    const key = `${r.owner_id}|${r.project_id}|${r.scheduled_date}`;
    const next = seen.get(key) || 0;
    seen.set(key, next + 1);
    db.run('UPDATE tasks SET position = ? WHERE id = ?', [next, r.id]);
  });
  if (rows.length) console.log(`Seeded positions for ${rows.length} task(s) across ${seen.size} day(s)`);
}

// Add a column to a table if it doesn't already exist. sql.js has no
// "ADD COLUMN IF NOT EXISTS", so we inspect the schema first.
function ensureColumn(table, column, definition) {
  const cols = queryAll(`PRAGMA table_info(${table})`);
  if (cols.some(c => c.name === column)) return false;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

// Atomic persistence: write to a temp file, then rename over the real one,
// so a crash mid-write can never leave a truncated database on disk
// (sql.js has no journal to recover from).
function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = dbPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, dbPath);
    // db.export() silently resets the foreign_keys pragma — reapply it
    // so cascades keep working for the next statement on this connection.
    db.run('PRAGMA foreign_keys = ON');
    dirty = false;
  }
}

// Writes mark the DB dirty; flushDb persists once per HTTP request (see the
// middleware in server.js) instead of exporting the whole DB per statement.
let dirty = false;

function flushDb() {
  if (dirty) saveDb();
}

function getDb() {
  return db;
}

// Helper to run query and get single result as object
function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// Helper to run query and get all results as array of objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper to run insert/update and get lastInsertRowid. Marks the DB dirty
// rather than persisting immediately — flushDb() writes the file once per
// request/shutdown, not once per statement.
function runSql(sql, params = []) {
  db.run(sql, params);
  const result = queryOne('SELECT last_insert_rowid() as id');
  dirty = true;
  return { lastInsertRowid: result.id };
}

module.exports = { initDb, getDb, saveDb, flushDb, queryOne, queryAll, runSql };

