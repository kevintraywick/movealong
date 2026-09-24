// The MoveIt server's tools, shared by both transports (2026-09-13):
// mcp/index.js runs them over stdio for Claude Code on the Mac; server.js
// mounts the same set over Streamable HTTP at /mcp/<secret> so the Claude
// phone app (Settings › Connectors) and any remote client can reach the board.
//
// Talks to the board over its REST API, never the database, so one build
// works against localhost, production, and — in-process — itself over loopback.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function createMoveItServer({ urlBase, team, user, aiKey = '', tz }) {
  const URL_BASE = String(urlBase || 'http://localhost:3000').replace(/\/$/, '');
  const TEAM = team, USER = user, AI_KEY = aiKey || '';
  const TZ = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (!TEAM || !USER) throw new Error('createMoveItServer needs team and user');

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

  const server = new McpServer({ name: 'moveit', version: '0.2.0' });

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

  // Free-standing notes (2026-09-16) — NOT a task's note feed (that is
  // add_note). "Claude, send a note to MoveIt that says …" lands here.
  server.registerTool('send_note', {
    title: 'Send a note to the Notes page',
    description: 'Send the user a free-standing note — a quote they heard, an idea, a feature request for MoveIt, anything to keep. It lands on their Notes page (/notes) as its own card, not on any task or board. Use add_note only for notes ON a task.',
    inputSchema: { body: z.string().min(1) }
  }, async ({ body }) => {
    const note = await api(`${me}/notes`, { method: 'POST', body: { body, source: 'mcp' } });
    return text({ ok: true, note, page: `${URL_BASE}/notes` });
  });

  server.registerTool('list_notes', {
    title: 'Read the Notes page',
    description: 'The user\'s free-standing notes, newest first (archived ones only if asked).',
    inputSchema: { include_archived: z.boolean().optional() }
  }, async ({ include_archived }) => text(await api(`${me}/notes${include_archived ? '?archived=1' : ''}`)));

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


  // ---- Morning briefing ----
  server.registerTool('get_briefing', {
    title: 'Read the morning briefing',
    description: 'The briefing items posted for a day (default today) with their ticked state, plus the day\'s weather for the user\'s ZIP (fetched by the board itself — never post a weather item).',
    inputSchema: { day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }
  }, async ({ day }) => text(await api(`${me}/briefing${day ? `?day=${day}` : ''}`)));

  server.registerTool('post_briefing', {
    title: 'Post the morning briefing',
    description: 'Replace the day\'s briefing (default today) with these items, in order. The board opens them as tickable rows in a pane under today\'s card. Kinds: calendar, mail, market, text, board, health, note. Keep it to a glance: at most 12 items, text under ~90 characters, detail for the sentence behind it, link for a mailto: reply draft (mail), an sms: (text) or an https: page. Call briefing_recipe first if you haven\'t read the recipe this session.',
    inputSchema: {
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      items: z.array(z.object({
        kind: z.enum(['calendar', 'mail', 'market', 'text', 'board', 'health', 'note']),
        text: z.string().min(1).max(200),
        detail: z.string().max(600).optional(),
        link: z.string().max(4000).optional()
      })).max(12)
    }
  }, async ({ day, items }) => text(await api(`${me}/briefing`, { method: 'PUT', body: { day, items } })));

  server.registerTool('tick_briefing_item', {
    title: 'Tick a briefing item',
    description: 'Mark a briefing item handled (or not).',
    inputSchema: { item_id: z.number().int(), done: z.boolean().optional() }
  }, async ({ item_id, done = true }) => text(await api(`/api/briefing-items/${item_id}`, { method: 'PUT', body: { done } })));

  server.registerTool('briefing_recipe', {
    title: 'How to build the morning briefing',
    description: 'The steps for assembling the user\'s morning briefing from mail, calendar, texts, the board and the health log. Read it, do it, then post_briefing.',
    inputSchema: {}
  }, async () => text(BRIEFING_RECIPE));

  server.registerPrompt('morning-brief', {
    title: 'Morning brief',
    description: 'Assemble and post today\'s morning briefing to the MoveIt board.'
  }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: BRIEFING_RECIPE } }] }));

  // ---- Mail strip ----
  const INBOX_ACTIONS = ['open', 'reply', 'forward', 'archive', 'delete', 'junk', 'unsubscribe', 'task'];
  server.registerTool('get_inbox', {
    title: 'Read the mail strip',
    description: 'The mail strip on the board: the rows shown (up to five), `queued` — actions the user clicked that you must now carry out in Gmail, then report with finish_inbox_action — and `learned`, each sender\'s history (a `suggest` action to propose, an `auto` action to just do). Call inbox_recipe first if you haven\'t read it this session.',
    inputSchema: {}
  }, async () => text(await api(`${me}/inbox`)));

  server.registerTool('post_inbox', {
    title: 'Post the mail strip',
    description: 'Replace the strip\'s set of unread Gmail threads, newest first, at most 20 (the board shows five, attention first). One item per thread. Rows the user already queued are left alone; rows missing from this post are dropped as read elsewhere. An item with auto: true is one you already handled under a learned `auto` rule: it is logged, not shown.',
    inputSchema: {
      unread_total: z.number().int().min(0).optional(),
      items: z.array(z.object({
        thread_id: z.string().min(1),
        sender_name: z.string().max(120).optional(),
        sender_addr: z.string().max(200).optional(),
        subject: z.string().max(300).optional(),
        body: z.string().max(300).optional(),
        received_at: z.string().max(40).optional(),
        attention: z.boolean(),
        action: z.enum(INBOX_ACTIONS),
        reason: z.string().max(300).optional(),
        view_url: z.string().max(4000).optional(),
        reply_link: z.string().max(4000).optional(),
        unsubscribe_link: z.string().max(4000).optional(),
        auto: z.boolean().optional()
      })).max(20)
    }
  }, async ({ items, unread_total }) => text(await api(`${me}/inbox`, { method: 'PUT', body: { items, unread_total } })));

  server.registerTool('finish_inbox_action', {
    title: 'Report a mail action done',
    description: 'After carrying out a queued mail-strip action in Gmail, report it. ok: false (with the error) puts the row back on the strip so the user sees it failed.',
    inputSchema: { item_id: z.number().int(), ok: z.boolean(), error: z.string().max(300).optional() }
  }, async ({ item_id, ok, error }) => text(await api(`/api/inbox-items/${item_id}/finish`, { method: 'PUT', body: { ok, error } })));

  server.registerTool('inbox_recipe', {
    title: 'How to run the mail strip',
    description: 'The steps for draining queued mail actions and posting the unread threads to the board\'s mail strip. Read it, do it.',
    inputSchema: {}
  }, async () => text(INBOX_RECIPE));

  server.registerPrompt('mail-strip', {
    title: 'Mail strip',
    description: 'Carry out the mail actions queued on the MoveIt board and repost the unread threads.'
  }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: INBOX_RECIPE } }] }));

  // ---- Calendar (2026-09-23) ----
  // The second way events reach the board: the secret-address feed is the
  // automatic one; this is Claude reading Google Calendar through its connector.
  server.registerTool('post_calendar', {
    title: 'Post calendar events',
    description: 'Put the user\'s timed calendar events for the next 14 days on the board, where each day shows them as quiet lines above its tasks. Send the whole 14 days every time: events this path posted earlier that are missing now are removed. All-day events are skipped. Pass each Google event\'s id (and its iCalUID if you have it) so an event the secret-address feed also brings stays one line. Call calendar_recipe first if you haven\'t read it this session.',
    inputSchema: {
      events: z.array(z.object({
        id: z.string().min(1).max(300),
        ical_uid: z.string().max(300).optional(),
        title: z.string().max(300),
        start: z.string().max(40).describe('ISO 8601 with offset, e.g. 2026-09-24T12:15:00-05:00'),
        end: z.string().max(40).optional(),
        location: z.string().max(300).optional(),
        link: z.string().max(1000).optional().describe('The event\'s htmlLink'),
        all_day: z.boolean().optional()
      })).max(200)
    }
  }, async ({ events }) => text(await api(`${me}/calendar/events`, { method: 'PUT', body: { events } })));

  server.registerTool('calendar_recipe', {
    title: 'How to post the calendar',
    description: 'The steps for reading Google Calendar and posting the next two weeks of events to the board.',
    inputSchema: {}
  }, async () => text(CALENDAR_RECIPE));

  server.registerPrompt('calendar-sync', {
    title: 'Calendar to the board',
    description: 'Read the next two weeks of Google Calendar and post the events to the MoveIt board.'
  }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: CALENDAR_RECIPE } }] }));

  return server;
}

// Kevin's own recipe, 2026-09-13 (sent from the phone; replaced the first draft wholesale).
// Personal facts — positions, trips, the sprint project, the step target — live in his
// brief, not here: this file is in a public repo. The recipe points at the brief for them.
export const BRIEFING_RECIPE = `Build my morning briefing and post it to the MoveIt board with post_briefing. Today is the board's today (list_tasks tells you). Work in this order and keep every item to one line a person can act on.

1. Context: get_brief (who I am, how I like things), list_tasks for today, get_health with weeks=2.

2. Calendar (kind "calendar"): today's events with start times, earliest first, e.g. "2:30 Dentist - leave by 2". Include a location if there is one. If nothing is on, one item: "Nothing on the calendar".

3. Mail (kind "mail"): count what arrived since yesterday morning as ONE item first ("14 new emails, 3 want a reply"). Then at most 4 items for the ones that actually need me - a reply owed, money, a deadline, a person I know. Each: who and what in under 90 characters, the gist in detail, and a link that is a mailto: reply draft - mailto:<sender>?subject=Re:%20<subject>&body=<a short reply in my voice, URL-encoded>. Skip newsletters and receipts.

4. Market (kind "market"): only if the previous day was a US market trading day (skip weekends and market holidays). One item summarizing the prior session generally - indices and any notable news. Then at most 2 items on the positions listed in my brief (stocks and options alike). If the brief lists none, post only the summary. Keep each to one line plus detail.

5. Texts (kind "text"): only if you can read Messages on this Mac (the unread-texts script in the repo). One item per unread thread: who said what, and an sms: link to them. If you can't read texts, post nothing for this kind.

6. Do NOT post a board status roll-up. No overdue items, no "N tasks slipped forward", no deadlines locked to today. If a goal is set for the day, that one line is fine.

7. Nudges (kind "board" unless a better kind fits) - at most 3, only when the trigger is actually met:
   - Oldest unanswered open question from get_brief. One line, the question itself.
   - A money deadline coming up in the next few days (bills, payment plans) - surface it ahead of time, not on the day.
   - Trip countdown with prep status for any trip named in my brief or on my calendar, e.g. "<city> in 4 days - packing list not started".
   - Whether I touched my current sprint project (named in my brief) yesterday. Long-term work is the thing that slips; one honest line.

8. Health (kind "health") - at most 2, only when triggered:
   - Steps under my daily step target (from my brief; 8,000 if it doesn't say), or a gap in the step log ("no steps logged for yesterday - say the number and I'll log it").
   - No gym in more than 3 days.
   - No yoga in more than 3 days.
   Nudge, do not lecture.

9. Do NOT post weather; the board fetches it from my ZIP itself.

At most 12 items total, in this order: calendar, mail, market, texts, nudges, health. Then call post_briefing once with the whole list. Tell me in one line what you posted.`;


// The mail strip (2026-09-23). Kevin's rules: unread mail in the inbox only
// (he tried "unread anywhere" and it surfaced ~200 filtered newsletters), two colours only — blue for "needs
// me", grey for the rest — and Tom learns from what he does with each sender.
export const INBOX_RECIPE = `Run my MoveIt mail strip: first do what I asked, then show me what's unread. Use the Gmail connector for the mail and the MoveIt tools for the board.

1. get_inbox. Read three things from it: \`queued\` (actions I clicked), \`learned\` (per-sender history) and \`items\` (what's on the strip now).

2. Carry out every queued row in Gmail, on the whole thread (thread_id), then call finish_inbox_action with its id:
   - delete: move the thread to the trash.
   - junk: mark the thread as spam.
   - archive: remove the INBOX and UNREAD labels.
   - unsubscribe: remove INBOX and UNREAD (the board already opened the unsubscribe link for me if there was one).
   - open, reply, forward, task: I handled it myself, so just remove UNREAD.
   If one fails, report ok: false with the error. Don't retry it in the same run.

3. Search unread threads in the inbox only: query "is:unread in:inbox", pageSize 20. Take unread_total from the result count estimate. If nothing is unread, post an empty list — that clears the strip.

4. Build one item per thread from its newest unread message:
   - sender_name: short, what I'd call them ("Railway", "Dollar Flight Club", "Margo"). sender_addr: the address.
   - Skip a thread whose newest message in the inbox isn't unread (Gmail matches a whole thread when any message is).
   - subject: as written. body: the first ~100 characters of the message text. Strip preheader filler (the invisible ͏ and zero-width runs), HTML entities and "View in browser" boilerplate.
   - attention: true only when it needs me: a real person writing to me and waiting on an answer, money owed or due, a deadline in the next few days, a security alert I didn't cause, or something of mine broken in production and still broken. Newsletters, promotions, receipts, routine notifications and alerts I caused myself are false. Most rows should be false.
   - action, one of open, reply, forward, archive, delete, junk, unsubscribe, task:
     reply when a person is waiting on me (set reply_link to mailto:<sender>?subject=Re:%20<subject>&body=<a short reply in my voice, URL-encoded>);
     task when it asks for work that takes more than a reply;
     forward when someone else should have it;
     archive for things worth keeping but not acting on;
     delete for expired offers, past events and notifications that were only a flag;
     junk for spam and phishing;
     unsubscribe for recurring mail I never open (set unsubscribe_link to an https: or mailto: unsubscribe address if the message has one);
     open when you can't tell.
   - reason: one sentence explaining the light and the action. The board shows it in the tip bar when I hover the row.
   - view_url: the thread's Gmail viewUrl. received_at: the newest message's ISO date.

5. Check \`learned\` for each sender (compare addresses case-insensitively). If there is a \`suggest\` action, use it. If there is an \`auto\` action and the row isn't attention, do that action in Gmail yourself now, the same way as step 2, and post the row with auto: true. The board logs it and doesn't show it. Never auto-handle a row with attention.

6. Call post_inbox once with every item and unread_total. Then tell me in one line: how many queued actions you did, how many rows you posted, and anything you handled on your own.`;


// The calendar band (2026-09-23). Kevin's calls: events are facts, drawn as
// plain lines above each day's tasks; both paths feed it (the secret-address
// feed on its own, this recipe through the connector).
export const CALENDAR_RECIPE = `Put my calendar on the MoveIt board. Use the Google Calendar connector to read and the MoveIt tools to write.

1. list_tasks tells you the board's today. The window is today plus the next 13 days.

2. List events on my primary calendar across that window, ordered by start time, in my time zone. Include every calendar I'd call mine (list_calendars) but skip shared holiday, birthday and sports calendars.

3. Skip all-day events, events I declined, cancelled events, and events marked free (transparency "transparent"). Working-location and out-of-office blocks are skipped too.

4. For each event send: id (the Google event id), ical_uid if the event has one, title, start and end as ISO 8601 with offset, location if there is one, and link (the event's htmlLink).
   The title is the shortest words that still say what it is: cut filler and redundancy. "Appointment with City Eyeworks" is "City Eyeworks"; "Meeting with Margo about Q4 budget" is "Margo - Q4 budget"; "Dr. Patel dental cleaning appointment" is "Dr. Patel dental cleaning". Drop "Invitation:", "Reminder:", my own name, and dates or times repeated in the title. Keep names, places and the thing itself. Under about 24 characters when you can.

5. Call post_calendar once with the whole list, even if it's empty — the post is the complete picture, and anything missing from it leaves the board.

Tell me in one line how many events you posted and for which days.`;
