const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, queryOne, queryAll, runSql, saveDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

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
  
  // Check if subdomain already exists
  const existing = queryOne('SELECT id FROM companies WHERE subdomain = ?', [subdomain]);
  if (existing) {
    return res.status(409).json({ error: 'A team with this name already exists' });
  }

  const userSlug = generateSlug(userName);
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

  const projectSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30) || 'project';

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

  const projects = queryAll(`
    SELECT p.id, p.name, p.slug, p.created_by, p.created_at
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ?
    ORDER BY p.created_at
  `, [user.id]);

  res.json(projects);
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

  // Spillover: move incomplete past tasks to today
  const today = new Date().toISOString().split('T')[0];
  const spilloverParams = [today, new Date().toISOString(), user.id, today];
  let spilloverSql = `
    UPDATE tasks
    SET scheduled_date = ?, updated_at = ?
    WHERE owner_id = ?
      AND completed = 0
      AND scheduled_date < ?
  `;
  if (req.query.project_id) {
    spilloverSql += ' AND project_id = ?';
    spilloverParams.push(parseInt(req.query.project_id));
  }
  runSql(spilloverSql, spilloverParams);

  let taskSql = `
    SELECT
      t.id,
      t.description,
      t.scheduled_date,
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
    taskSql += ' AND t.project_id = ?';
    taskParams.push(parseInt(req.query.project_id));
  }
  taskSql += ' ORDER BY t.scheduled_date, t.created_at';

  const tasks = queryAll(taskSql, taskParams);
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

  try {
    const result = runSql(
      'INSERT INTO tasks (company_id, owner_id, project_id, description, scheduled_date) VALUES (?, ?, ?, ?, ?)',
      [company.id, user.id, project_id || null, description, scheduled_date]
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      description,
      scheduled_date,
      project_id: project_id || null,
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
  const { scheduled_date, completed } = req.body;

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

    const updated = queryOne(`
      SELECT
        t.id,
        t.description,
        t.scheduled_date,
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
    runSql(`
      UPDATE tasks 
      SET owner_id = ?, assigned_by = ?, scheduled_date = ?, updated_at = ?
      WHERE id = ?
    `, [to_user_id, task.owner_id, scheduled_date, new Date().toISOString(), taskId]);

    const updated = queryOne(`
      SELECT 
        t.id, 
        t.description, 
        t.scheduled_date, 
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
      SET owner_id = ?, assigned_by = ?, scheduled_date = ?, updated_at = ?
      WHERE id = ?
    `, [originalAssignerId, currentOwnerId, scheduled_date || task.scheduled_date, new Date().toISOString(), taskId]);

    const updated = queryOne(`
      SELECT 
        t.id, 
        t.description, 
        t.scheduled_date, 
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

  const task = queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  try {
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

// Get subtasks for a task
app.get('/api/tasks/:taskId/subtasks', (req, res) => {
  const { taskId } = req.params;

  const task = queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const subtasks = queryAll(`
    SELECT id, task_id, parent_subtask_id, description, assignee_type,
           assigned_to, assigned_by, sort_order, completed, completed_at,
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
      'INSERT INTO tasks (company_id, owner_id, project_id, assigned_by, description, scheduled_date) VALUES (?, ?, ?, ?, ?, ?)',
      [task.company_id, to_user_id, task.project_id, task.owner_id, subtask.description, scheduled_date]
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
    const today = new Date().toISOString().split('T')[0];
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
app.post('/api/tasks/:taskId/generate-subtasks', async (req, res) => {
  const { taskId } = req.params;

  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Delete existing auto-generated subtasks
  runSql('DELETE FROM subtasks WHERE task_id = ?', [taskId]);

  try {
    let subtaskList;

    // Try AI generation if available
    try {
      const ai = require('./ai');
      subtaskList = await ai.generateSubtasks(task.description);
    } catch (e) {
      // Fall back to mock
      subtaskList = generateMockSubtasks(task.description);
    }

    const created = [];
    subtaskList.forEach((st, i) => {
      const result = runSql(
        `INSERT INTO subtasks (task_id, parent_subtask_id, description, assignee_type, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [taskId, st.parent_subtask_id || null, st.description, st.assignee_type || 'human', i]
      );
      created.push({
        id: result.lastInsertRowid,
        task_id: parseInt(taskId),
        parent_subtask_id: st.parent_subtask_id || null,
        description: st.description,
        assignee_type: st.assignee_type || 'human',
        assigned_to: null,
        assigned_by: null,
        sort_order: i,
        completed: 0,
        completed_at: null
      });
    });

    res.status(201).json(created);
  } catch (err) {
    console.error('Error generating subtasks:', err);
    res.status(500).json({ error: 'Failed to generate subtasks' });
  }
});

function generateMockSubtasks(description) {
  const desc = description.toLowerCase();

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
      SELECT t.id, t.description, t.scheduled_date, t.completed, t.assigned_by,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) as subtask_count,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND completed = 1) as completed_subtask_count
      FROM tasks t
      WHERE t.project_id = ? AND t.owner_id = ? AND t.completed = 0
      ORDER BY t.scheduled_date, t.created_at
    `, [project.id, user.id]);

    return { ...project, tasks };
  });

  res.json({ projects: result });
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database and start server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Move Along API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
