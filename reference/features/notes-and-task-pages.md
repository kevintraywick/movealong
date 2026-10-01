# Notes and task pages

> Read when touching /notes, send_note, /task/:id, background/notes/results. Moved out of CLAUDE.md verbatim on 2026-09-30; keep adding here, not there.

### Notes (/notes, 2026-09-16)
- **Kevin's compromise for working from the phone**: the phone Claude *sends*, the board *keeps*. "Claude, send a note to MoveIt that says …" → the MoveIt server's **`send_note`** → a card on **`/notes`**. Quotes, ideas, feature requests for MoveIt — anything. The desktop session reads them with `list_notes` (or he pastes one) when MoveIt work starts; a note becomes a task only on his word. He agreed not to over-purpose the phone app (no code edits from it; that is Claude Code cloud sessions / Remote Control, see memory).
- **Per user, not per board** (`notes` table: body, `source` web|mcp, ISO timestamps, `archived_at`). Routes: `GET/POST .../notes` (`?archived=1`, `?count=1&since=` for the dot), `PUT/DELETE /api/notes/:id`. **`add_note` is still the task-page feed** — the tool descriptions say which is which.
- **The page** (`public/notes.html`, one static file): composer on top (⌘⏎), CSS-columns masonry of cards, newest first. Per card: Edit (⌘⏎ / Esc), **Make it a task** (first line → today on the first board, the whole note as the task's background, note archived), Archive / Restore / Delete (confirm). A `phone` chip on `source = 'mcp'`; a blue left edge on notes newer than `localStorage['movealong.notes.seen']`, which the visit writes. Light and dark; `renderRich()` copied from the task page (escape first).
- **Door: a notes icon in the header just left of the dashboard icon** (`#notesLink`, inline SVG, `.icon-toggle`); `#notesLink { margin-left: auto }` now carries the float that `#dashboardLink` had. **A blue dot** (`.unread::after`) when `refreshNotesBadge()` (from `loadTasks()`) counts notes since the last visit; the title carries the count.

### Task pages (/task/:id, 2026-08-21)
- **Every task has its own page** — `GET /task/:id` serves `public/task.html` (one static file like `/help`), reads its id from the URL, talks to `/api/tasks/:id/page`. Reachable by anyone with the link.
- **Three panes: Background & instructions** (kept short), **Notes**, **Results**. Header: owner · board · created day and an open/completed chip.
- **`tasks.background` and `tasks.results` live on the task row**, so finished handed-over work carries the assignee's results home — the move IS the delivery. Board-only completion leaves Results blank ("Completed on the board — no results were posted").
- **Notes are an append-only feed with attribution** (`task_notes`: task_id CASCADE, author_id SET NULL). The composer sends `author_slug` from the browser session; with no auth that is trust, not proof. Links render as anchors; **image URLs render inline** (`renderRich()`: escape first, rebuild hrefs, `.png/.jpg/.jpeg/.gif/.webp` become `<img>`).
- **Access: Option+Click the task name** (board and List; alt WITHOUT shift — Shift+Option is quick-lock). Awaiting rows support it via a dedicated listener (their description has no `data-task-id`). Both editable panes autosave (debounce + blur) with a quiet state word.
- **SQLite's `CURRENT_TIMESTAMP` ("YYYY-MM-DD HH:MM:SS") is rejected by Safari's `new Date()`** — `dayLabel()` normalizes to ISO-with-Z first.
- **Postgres considered and declined** (2026-08-21): the Railway volume persists SQLite; revisit only for multi-instance scaling or real concurrent writes.
