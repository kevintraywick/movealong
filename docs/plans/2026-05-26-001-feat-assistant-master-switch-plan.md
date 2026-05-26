---
title: "feat: AI assistant master switch in top row"
type: feat
status: completed
date: 2026-05-26
---

# AI Assistant Master Switch

## Overview

Add a master on/off switch to the top row of the Move Along page that controls
whether the AI assistant runs. The "AI assistant" is the automatic subtask
generation that currently fires every time a task is added — the frontend calls
`POST /api/tasks/:taskId/generate-subtasks` immediately after creating a task.
When the switch is OFF, adding a task no longer triggers automatic subtask
generation; the task is simply added.

## Problem Frame

Today, every task add auto-generates up to 10 subtasks via Claude (`server/src/ai.js`),
auto-expands the subtask pane, and shows a generating spinner. This is the core
"move ideas into action" loop, but the user has no way to turn it off — for fast
bulk entry, offline/no-API situations, or when they just want a plain to-do list.
A single visible master switch in the header gives the user explicit control over
the assistant without changing any per-task interactions.

## Requirements Trace

- R1. A master switch is visible in the top row (`.app-header`) of the page.
- R2. Toggling the switch turns the AI assistant ON or OFF.
- R3. When OFF, adding a task (calendar board **and** master page) does not
  auto-generate subtasks and does not auto-expand/spin the subtask pane.
- R4. When ON, behavior is exactly as today (no regression).
- R5. The switch state persists across reloads.
- R6. The switch defaults to ON for existing/new users (preserves current behavior).

## Scope Boundaries

- Non-goal: per-project or per-day assistant toggles. This is one global switch.
- Non-goal: server-side enforcement / auth. The `generate-subtasks` endpoint stays
  open; the switch only governs whether the **frontend** calls it.
- Non-goal: changing the subtask generation prompt, model, or output.
- Non-goal: a settings page or any other preferences. Just this one control.
- Non-goal (per assumption A2): disabling the manual "regenerate" button when OFF.

## Context & Research

### Relevant Code and Patterns

- **Header markup** — `server/public/index.html:1470-1504`. The `.view-toggle`
  Calendar/Master control (`:1497-1500`) is the closest sibling pattern for a
  header-mounted control with active styling (`.view-toggle` / `.view-toggle-btn`
  CSS at `:928-952`). Place the switch in this row.
- **App state block** — `server/public/index.html:1582-1598`. Top-level `let`
  declarations (`viewMode`, `expandedTaskIds`, `generatingSubtasksFor`). Add the
  assistant state here.
- **Auto-generation call sites** — the two "when a task is added" flows:
  - `addTask(description, dateKey)` — `:1867`, auto-gen block at `:1892-1905`.
  - `addTaskFromMaster(description, projectId)` — `:1912`, auto-gen block at `:1924-1936`.
  - Both: add task → `expandedTaskIds.add(newTask.id)` → set `generatingSubtasksFor`
    → render → `await api('/tasks/:id/generate-subtasks')` → store in `taskSubtasks`
    → clear `generatingSubtasksFor` → render. The gate wraps this block.
- **Manual regenerate** — `regenerateSubtasks(taskId)` at `:2060` is a separate,
  explicit user action (button). Not part of the "when added" flows. See assumption A2.
- **Persistence pattern** — `server/public/index.html:1604-1628`. Existing
  localStorage session helpers (`SESSION_KEY = 'movealong.session'`,
  `saveSession`/`loadSession`/`clearSession`) wrapped in try/catch for quota/disabled.
  Mirror this exact shape for the switch.
- **Toast + render helpers** — `showToast(...)`, `renderView()` (dispatches to
  `renderBoard`/`renderMasterPage`), available globally.
- **View toggle wiring** — event listeners at `:2821-2830` show the pattern for
  binding a header control and reflecting active state via a CSS class.

### Institutional Learnings

- No `docs/solutions/` entries in this repo. CLAUDE.md conventions that bind:
  keep the frontend a single `public/index.html`; backend changes require restart;
  test via `http://localhost:3000`, not `file://`.

### External References

- None required. This is a self-contained frontend change following an established
  in-file pattern (header control + localStorage). No external research warranted.

## Key Technical Decisions

- **Frontend-only, localStorage-backed (Assumption A1).** Store state in
  `localStorage` under `movealong.assistant`, mirroring the session pattern. No
  `db.js` / `server.js` changes. Rationale: matches the request ("a master switch
  on the page"), matches the existing client-orchestrates-AI architecture (the
  server never auto-generates), and is the smallest change. Trade-off: the setting
  is per-browser/device, not synced. If cross-device sync is later required, migrate
  to a `users.assistant_enabled` column + settings endpoint (deferred).
- **Gate at the call sites, not the API.** Wrap the auto-gen block in `addTask`
  and `addTaskFromMaster` in an `if (assistantEnabled)` guard. The endpoint stays
  reachable so manual regenerate keeps working.
- **Default ON.** Absent/invalid localStorage value is treated as ON, preserving
  today's behavior for everyone (R6).
- **Reuse the view-toggle visual idiom** so the control looks native to the header.

## Open Questions

### Resolved During Planning

- Where is auto-generation triggered? — Frontend, not server. Confirmed at
  `index.html:1898` and `:1930`; server has no task-create → subtask hook.
- Which add flows need gating? — Both `addTask` (calendar) and `addTaskFromMaster`
  (master page).

### Deferred to Implementation

- Exact switch widget form (toggle/checkbox vs two-button segmented control like
  view-toggle). Decide during implementation to best match header styling; behavior
  is unaffected.
- Exact label/copy ("AI assistant", "Assistant", icon + state). Pick during build;
  keep it short to fit the row.

## Assumptions (flip these if wrong)

- **A1 — Persistence:** localStorage, global per-browser. (Alternative considered:
  per-user DB column for cross-device sync — heavier, deferred.)
- **A2 — Scope of OFF:** OFF disables **auto-generation on task add only**. The
  manual "regenerate" button (`regenerateSubtasks`, `:2060`) remains available,
  since it is explicit user intent. (Alternative: also hide/disable regenerate when
  OFF — easy to add later by guarding/hiding that button.)

## Implementation Units

- [x] **Unit 1: Assistant state + persistence helpers**

**Goal:** Introduce the global `assistantEnabled` state and localStorage persistence,
defaulting to ON.

**Requirements:** R5, R6

**Dependencies:** None

**Files:**
- Modify: `server/public/index.html` (app state block ~`:1582-1598`; persistence
  section ~`:1604-1628`)

**Approach:**
- Add `let assistantEnabled = true;` to the app-state block.
- Add `ASSISTANT_KEY = 'movealong.assistant'` and small `loadAssistantPref()` /
  `saveAssistantPref()` helpers mirroring the existing session helpers (try/catch,
  treat missing/invalid as ON).
- On startup (where session/app init runs), call `loadAssistantPref()` to seed state.

**Patterns to follow:**
- `SESSION_KEY` helpers at `:1604-1628` (same try/catch shape, same naming style).

**Test scenarios (manual, no suite exists):**
- Fresh browser (no key): state is ON.
- Corrupt/non-boolean value in localStorage: falls back to ON, no console error.
- Set OFF, reload: state remains OFF.

**Verification:**
- In devtools, `localStorage['movealong.assistant']` reflects the chosen state and
  survives reload; default with no key is ON.

- [x] **Unit 2: Master switch UI in the top row**

**Goal:** Render a visible switch in `.app-header` and wire it to toggle and persist
`assistantEnabled`.

**Requirements:** R1, R2, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `server/public/index.html` (header markup `:1470-1504`; CSS near
  `.view-toggle` `:928-952`; event wiring near `:2821-2830`)

**Approach:**
- Add a switch control in the header row, adjacent to `.view-toggle`. Reflect ON/OFF
  via an active/checked CSS class, reusing the view-toggle visual idiom.
- On change: set `assistantEnabled`, call `saveAssistantPref()`, update the control's
  visual state, and `showToast('AI assistant on/off')`.
- Ensure initial render reflects the loaded state (control shows correct position on
  load).

**Patterns to follow:**
- `.view-toggle` markup/CSS (`:928-952`, `:1497-1500`) and its listeners (`:2821-2830`).

**Test scenarios (manual):**
- Switch renders in the top row and shows correct initial position from saved state.
- Clicking toggles visual state and shows a confirming toast.
- State persists across reload (ties to Unit 1).

**Verification:**
- The control is visible in the header, toggles, persists, and starts in the saved
  position (ON by default).

- [x] **Unit 3: Gate auto-generation on the switch**

**Goal:** When OFF, skip automatic subtask generation (and the auto-expand/spinner)
in both add flows; when ON, behavior is unchanged.

**Requirements:** R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `server/public/index.html` (`addTask` auto-gen block `:1892-1905`;
  `addTaskFromMaster` auto-gen block `:1924-1936`)

**Approach:**
- In each flow, guard the auto-gen block with `if (assistantEnabled) { ... }`.
- When OFF: still add the task and render, but do **not** set `generatingSubtasksFor`,
  do **not** auto-add to `expandedTaskIds`, and do **not** call `generate-subtasks`.
- Confirm the post-add render path still runs in both branches (task appears on the
  board / master page either way).

**Patterns to follow:**
- Existing auto-gen blocks; keep the ON-path code path byte-for-byte equivalent to
  today inside the guard to guarantee R4 (no regression).

**Test scenarios (manual):**
- Switch ON → add task on calendar: subtasks auto-generate, pane expands (unchanged).
- Switch ON → add task on master page: same.
- Switch OFF → add task on calendar: task appears, no spinner, no subtasks, pane not
  auto-expanded.
- Switch OFF → add task on master page: same.
- Toggle OFF→ON mid-session: next added task generates again (no reload needed).
- Switch OFF → existing task's manual "regenerate" still generates (per A2).

**Verification:**
- With OFF, network panel shows **no** `POST /generate-subtasks` on task add; with
  ON, exactly one such call per add, as today.

## System-Wide Impact

- **Interaction graph:** Only the two add flows read `assistantEnabled`. Manual
  `regenerateSubtasks` and the `generate-subtasks` endpoint are untouched (A2).
- **Error propagation:** Unchanged. The existing try/catch around `generate-subtasks`
  remains inside the guard; OFF simply never enters it.
- **State lifecycle risks:** `assistantEnabled` is module-level mutable state read at
  add time, so toggling takes effect immediately without reload. localStorage writes
  are wrapped in try/catch (quota/disabled safe), matching session helpers.
- **API surface parity:** No API change. Server keeps generating subtasks on request;
  this is purely a client decision about whether to ask.
- **Integration coverage:** No automated suite exists; verification is manual at
  `http://localhost:3000` per CLAUDE.md. Cover both add flows and both switch states.

## Risks & Dependencies

- **Regression risk on the ON path (R4):** keep ON-path code identical inside the
  guard; the only change is wrapping, not rewriting.
- **Two parallel add flows can drift:** the same guard must be applied to both
  `addTask` and `addTaskFromMaster`; missing one leaves master-page adds ungated.
- **localStorage disabled/private mode:** helpers must fall back to in-memory default
  (ON) without throwing — covered by mirroring the session-helper try/catch.

## Documentation / Operational Notes

- No deploy/runtime config changes (no new env vars, no DB migration, no Railway
  changes). Single-file frontend edit; standard `npm start` restart to serve.
- Optional: add a one-line note to MoveAlong `CLAUDE.md` "Key Design Decisions" that
  the assistant is user-toggleable and defaults ON. Low priority.

## Sources & References

- Header markup: `server/public/index.html:1470-1504`
- View-toggle pattern: `server/public/index.html:928-952`, `:1497-1500`, `:2821-2830`
- Add flows / auto-gen: `server/public/index.html:1867-1941`
- Manual regenerate: `server/public/index.html:2060-2072`
- localStorage session pattern: `server/public/index.html:1604-1628`
- AI generation backend (unchanged): `server/src/ai.js`, `server/src/server.js:864`
