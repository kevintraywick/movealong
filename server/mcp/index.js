#!/usr/bin/env node
// MoveAlong as an MCP server (2026-09-13).
//
// Architecture B from reference/agents-primer.md: the board holds no
// credentials and runs no agents. It exposes itself as tools, and the
// user's own Claude — with whatever mail, calendar and files it already
// has — does the work and writes results back through the same tools.
//
// Talks to the board over its REST API, never the database, so the same
// server works against localhost and against production. Configure with
// env: MOVEALONG_URL, MOVEALONG_TEAM (subdomain), MOVEALONG_USER (slug),
// MOVEALONG_AI_KEY (x-ai-key, optional), MOVEALONG_TZ (IANA, optional).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const URL_BASE = (process.env.MOVEALONG_URL || 'http://localhost:3000').replace(/\/$/, '');
const TEAM = process.env.MOVEALONG_TEAM;
const USER = process.env.MOVEALONG_USER;
const AI_KEY = process.env.MOVEALONG_AI_KEY || '';
const TZ = process.env.MOVEALONG_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

if (!TEAM || !USER) {
  console.error('movealong-mcp: set MOVEALONG_TEAM and MOVEALONG_USER (the team subdomain and your user slug)');
  process.exit(1);
}

const me = `/api/companies/${encodeURIComponent(TEAM)}/users/${encodeURIComponent(USER)}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(URL_BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tz': TZ,
      ...(AI_KEY ? { 'x-ai-key': AI_KEY } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status} on ${method} ${path}`);
  return data;
}

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

// A board by name (case-insensitive) or id; default = the first tab.
async function resolveBoard(board) {
  const boards = await api(`${me}/projects`);
  if (!boards.length) throw new Error('You have no boards yet');
  if (board == null || board === '') return boards[0];
  const byId = boards.find(b => String(b.id) === String(board));
  if (byId) return byId;
  const byName = boards.find(b => b.name.toLowerCase() === String(board).toLowerCase());
  if (byName) return byName;
  throw new Error(`No board called "${board}". Boards: ${boards.map(b => b.name).join(', ')}`);
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const slimTask = (t) => ({
  id: t.id, description: t.description, scheduled_date: t.scheduled_date, completed: !!t.completed,
  locked: !!t.locked, goal: !!t.goal, repeat_rule: t.repeat_rule || null, project_id: t.project_id,
  source: t.source || null, assigned_by_name: t.assigned_by_name || null, completed_by_name: t.completed_by_name || null,
  origin_date: t.origin_date
});

const server = new McpServer({ name: 'movealong', version: '0.1.0' });

server.registerTool('list_boards', {
  title: 'List boards',
  description: 'The user\'s boards (projects), in their tab order, with each board\'s id and how many locked tasks are due today.'
}, async () => text((await api(`${me}/projects`)).map(b => ({ id: b.id, name: b.name, due_today: b.due_today || 0 }))));

server.registerTool('list_tasks', {
  title: 'List tasks',
  description: 'Tasks on one board. Pending only unless include_completed. Optional day window (YYYY-MM-DD, inclusive). Reading the board runs the board\'s own spillover, so overdue tasks appear on today.',
  inputSchema: {
    board: z.string().optional().describe('Board name or id; default = first board'),
    include_completed: z.boolean().optional(),
    from: z.string().optional().describe('YYYY-MM-DD'),
    to: z.string().optional().describe('YYYY-MM-DD')
  }
}, async ({ board, include_completed, from, to }) => {
  const b = await resolveBoard(board);
  let tasks = await api(`${me}/tasks?project_id=${b.id}`);
  if (!include_completed) tasks = tasks.filter(t => !t.completed);
  if (from) tasks = tasks.filter(t => t.scheduled_date >= from);
  if (to) tasks = tasks.filter(t => t.scheduled_date <= to);
  return text({ board: { id: b.id, name: b.name }, today: todayKey(), tasks: tasks.map(slimTask) });
});

server.registerTool('add_task', {
  title: 'Add a task',
  description: 'Create a task on a board. Defaults to today. If the day already holds seven, the board moves it to the next free day and the response says so. Optional background lands on the task page. With draft_steps, the assistant drafts up to seven steps under it (spends AI budget).',
  inputSchema: {
    description: z.string().min(1),
    board: z.string().optional(),
    scheduled_date: z.string().optional().describe('YYYY-MM-DD; default today'),
    background: z.string().optional().describe('Instructions/context for the task page'),
    locked: z.boolean().optional().describe('Lock it to that date (a deadline)'),
    draft_steps: z.boolean().optional()
  }
}, async ({ description, board, scheduled_date, background, locked, draft_steps }) => {
  const b = await resolveBoard(board);
  let task = await api(`${me}/tasks`, { method: 'POST', body: { description, scheduled_date: scheduled_date || todayKey(), project_id: b.id } });
  const requested = task.requested_date;
  if (background) await api(`/api/tasks/${task.id}/page`, { method: 'PUT', body: { background } });
  if (locked) task = { ...task, ...(await api(`/api/tasks/${task.id}`, { method: 'PUT', body: { locked: true, scheduled_date: task.scheduled_date } })) };
  let steps;
  if (draft_steps) steps = (await api(`/api/tasks/${task.id}/generate-subtasks`, { method: 'POST', body: {} })).subtasks;
  const moved = requested && requested !== task.scheduled_date;
  return text({ task: slimTask(task), page: `${URL_BASE}/task/${task.id}`, moved_to_next_free_day: !!moved, steps: steps && steps.map(s => ({ id: s.id, description: s.description })) });
});

server.registerTool('update_task', {
  title: 'Update a task',
  description: 'Complete or reopen, move to a date, lock/unlock, set the goal, or set a repeat (daily|weekly|monthly|null). Moving a series member moves its later steps too.',
  inputSchema: {
    task_id: z.number().int(),
    completed: z.boolean().optional(),
    scheduled_date: z.string().optional(),
    locked: z.boolean().optional(),
    goal: z.boolean().optional(),
    repeat_rule: z.enum(['daily', 'weekly', 'monthly']).nullable().optional(),
    description: z.string().optional()
  }
}, async ({ task_id, ...fields }) => {
  const body = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) body[k] = k === 'goal' ? (v ? 1 : 0) : v;
  if (!Object.keys(body).length) throw new Error('Nothing to update');
  return text(slimTask(await api(`/api/tasks/${task_id}`, { method: 'PUT', body })));
});

server.registerTool('get_task', {
  title: 'Read a task',
  description: 'Everything about one task: the row, its page (background, results, notes) and its steps.',
  inputSchema: { task_id: z.number().int() }
}, async ({ task_id }) => {
  const page = await api(`/api/tasks/${task_id}/page`);
  const steps = await api(`/api/tasks/${task_id}/subtasks`);
  return text({
    task: { ...slimTask(page.task), owner_name: page.task.owner_name, project_name: page.task.project_name, background: page.task.background || '', results: page.task.results || '' },
    notes: (page.notes || []).map(n => ({ id: n.id, author: n.author_name || null, body: n.body, at: n.created_at })),
    steps: steps.map(s => ({ id: s.id, description: s.description, assignee: s.assignee_type, completed: !!s.completed, researched: !!s.researched, parent_step_id: s.parent_subtask_id || null })),
    page: `${URL_BASE}/task/${task_id}`
  });
});

server.registerTool('add_note', {
  title: 'Add a note to a task',
  description: 'Append to the task page\'s note feed, attributed to the configured user. Use for what you found or did; results go in set_results.',
  inputSchema: { task_id: z.number().int(), body: z.string().min(1) }
}, async ({ task_id, body }) => text(await api(`/api/tasks/${task_id}/notes`, { method: 'POST', body: { body, author_slug: USER } })));

server.registerTool('set_results', {
  title: 'Write a task\'s results',
  description: 'Set the Results pane on the task page (replaces). Optionally the Background too. Markdown-ish plain text; URLs and image URLs render.',
  inputSchema: { task_id: z.number().int(), results: z.string().optional(), background: z.string().optional() }
}, async ({ task_id, results, background }) => {
  const body = {};
  if (results !== undefined) body.results = results;
  if (background !== undefined) body.background = background;
  if (!Object.keys(body).length) throw new Error('Give results and/or background');
  return text(await api(`/api/tasks/${task_id}/page`, { method: 'PUT', body }));
});

server.registerTool('add_step', {
  title: 'Add a step to a task',
  description: 'Add a step (subtask) under a task. assignee "ai" marks it as the assistant\'s; "human" (default) as the person\'s. A pane shows at most seven pending steps.',
  inputSchema: { task_id: z.number().int(), description: z.string().min(1), assignee: z.enum(['human', 'ai']).optional() }
}, async ({ task_id, description, assignee }) => text(await api(`/api/tasks/${task_id}/subtasks`, { method: 'POST', body: { description, assignee_type: assignee || 'human' } })));

server.registerTool('tick_step', {
  title: 'Tick or untick a step',
  description: 'Complete (or reopen) one step. Completing is also how a slot is freed in the pane; there is no delete.',
  inputSchema: { step_id: z.number().int(), completed: z.boolean().optional().describe('default true') }
}, async ({ step_id, completed }) => text(await api(`/api/subtasks/${step_id}`, { method: 'PUT', body: { completed: completed !== false } })));

server.registerTool('promote_step', {
  title: 'Promote a step to a task',
  description: 'Make a step a task of its own on the board, on its parent task\'s day.',
  inputSchema: { step_id: z.number().int() }
}, async ({ step_id }) => text(await api(`/api/subtasks/${step_id}/promote`, { method: 'POST', body: {} })));

server.registerTool('get_brief', {
  title: 'Read the brief',
  description: 'The standing notes the assistant reads before every task: contact and health fields, About you, Travel, this board\'s notes, what it has inferred (learned), and the open questions it wishes it knew.',
  inputSchema: { board: z.string().optional() }
}, async ({ board }) => {
  const b = await resolveBoard(board);
  const brief = await api(`${me}/projects/${b.id}/brief`);
  return text({
    board: { id: b.id, name: b.name },
    contact: brief.contact, medical: brief.medical,
    personal: brief.personal || '', travel: brief.travel || '', board_notes: brief.board || '',
    learned: brief.learned, open_questions: brief.questions
  });
});

server.registerTool('append_brief', {
  title: 'Add a line to the brief',
  description: 'Append one note to a brief layer: personal (About you, every board), travel, or board (this board only). Use it to record something learned on the user\'s behalf — a doctor\'s name, a preference they stated. Never write phone numbers or medical details here unless the user gave them for this purpose.',
  inputSchema: { scope: z.enum(['personal', 'travel', 'board']), line: z.string().min(1), board: z.string().optional() }
}, async ({ scope, line, board }) => {
  const b = await resolveBoard(board);
  const brief = await api(`${me}/projects/${b.id}/brief`);
  const cur = (brief[scope] || '').replace(/\s+$/, '');
  const clean = line.trim().replace(/^[-*•]\s*/, '');
  if (cur.split('\n').some(l => l.replace(/^[-*•]\s*/, '').trim().toLowerCase() === clean.toLowerCase())) return text({ ok: true, already_there: true });
  await api(`${me}/projects/${b.id}/brief`, { method: 'PUT', body: { [scope]: (cur ? cur + '\n' : '') + '- ' + clean } });
  return text({ ok: true, scope, line: clean });
});

server.registerTool('set_contact_field', {
  title: 'Set a contact field',
  description: 'Set one field of the user\'s contact section on the brief: full_name, nickname, phone, email, address, discord, notes.',
  inputSchema: { field: z.enum(['full_name', 'nickname', 'phone', 'email', 'address', 'discord', 'notes']), value: z.string(), board: z.string().optional() }
}, async ({ field, value, board }) => {
  const b = await resolveBoard(board);
  const brief = await api(`${me}/projects/${b.id}/brief`);
  const contact = { ...(brief.contact || {}), [field]: value };
  await api(`${me}/projects/${b.id}/brief`, { method: 'PUT', body: { contact } });
  return text({ ok: true, contact });
});

server.registerTool('completions', {
  title: 'Completed per day',
  description: 'What the user completed in a month, per day and per board (the dashboard\'s data). month = YYYY-MM, default this month.',
  inputSchema: { month: z.string().optional() }
}, async ({ month }) => text(await api(`${me}/completions${month ? `?month=${month}` : ''}`)));

server.registerTool('get_health', {
  title: 'Health log',
  description: 'The health dashboard\'s entries (steps, weight in lb, gym, yoga) for the last N weeks, keyed by day. Entered by hand each morning; steps/gym/yoga are about the day they are recorded against.',
  inputSchema: { weeks: z.number().int().min(1).max(26).optional() }
}, async ({ weeks }) => text(await api(`${me}/health${weeks ? `?weeks=${weeks}` : ''}`)));

server.registerTool('log_health', {
  title: 'Log health for a day',
  description: 'Record steps, weight (lb), gym and/or yoga for one day. day defaults to yesterday (the morning entry). Omit a field to leave it alone; pass null to clear it. Days in the future are refused.',
  inputSchema: {
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    steps: z.number().int().min(0).nullable().optional(),
    weight: z.number().min(0).nullable().optional(),
    gym: z.boolean().nullable().optional(),
    yoga: z.boolean().nullable().optional()
  }
}, async ({ day, ...fields }) => {
  const d = new Date(todayKey() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  const target = day || d.toISOString().slice(0, 10);
  const body = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) body[k] = v;
  if (!Object.keys(body).length) throw new Error('Give at least one of steps, weight, gym, yoga');
  return text(await api(`${me}/health/${target}`, { method: 'PUT', body }));
});

const transport = new StdioServerTransport();
await server.connect(transport);
