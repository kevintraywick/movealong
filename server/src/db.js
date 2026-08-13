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
      description TEXT NOT NULL,
      scheduled_date DATE NOT NULL,
      origin_date DATE,
      parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      locked INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
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
      sort_order INTEGER DEFAULT 0,
      provisional INTEGER DEFAULT 0,
      researched INTEGER DEFAULT 0,
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

  // Migrations for existing databases (ALTER TABLE is idempotent-guarded via table_info)
  ensureColumn('tasks', 'locked', 'INTEGER DEFAULT 0');
  ensureColumn('tasks', 'origin_date', 'DATE');
  // Series: a task points at its predecessor; NULL = not in a series.
  ensureColumn('tasks', 'parent_task_id', 'INTEGER REFERENCES tasks(id) ON DELETE SET NULL');
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
  // Marks a row the research pass actually rewrote, so the pane can show which
  // steps are real findings and which are still drafts.
  ensureColumn('subtasks', 'researched', 'INTEGER DEFAULT 0');
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

  saveDb();
  return db;
}

// Add a column to a table if it doesn't already exist. sql.js has no
// "ADD COLUMN IF NOT EXISTS", so we inspect the schema first.
function ensureColumn(table, column, definition) {
  const cols = queryAll(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
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

