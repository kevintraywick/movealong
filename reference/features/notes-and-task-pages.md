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

### Notes are always editable, styled like a list (2026-10-01)
- **No Edit button** (Kevin: "editable all the time … style notes in the same way that lists are"). Each card's text is a borderless `textarea.note-text` that grows to fit (`grow()`) and **autosaves** 700ms after typing stops and on blur (`queueSave()` / `saveNote()`). An emptied note is never saved, and blur puts the text back: Archive and Delete are how a note goes. Escape blurs.
- **A dashed "Add a line…" slot under the text** (`input.addline`, the list card's add-item slot): Enter appends the line to the note, saves, and leaves you on a fresh blank line.
- **The composer is the lists page's one-line box.** Enter creates the note and moves focus to that card's blank line, so a note is written line by line. Multi-line notes still come in from the phone (`send_note`) or by pasting into a card's text.
- **Links and pictures render under the text** (`.note-links`, from `linksFor()`), since a field can't show them. This keeps what the old read-only card rendered inline. They refresh on save.
- Cards wear a **blue left edge** (`#bae6fd`), a note's colour the way pink is a list's; a note newer than the last visit wears full `#0ea5e9`. Make it a task and Archive save any pending edit first.
