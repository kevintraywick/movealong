# MoveAlong — Design Notes

Living document of design decisions, conventions, and "do / don't" rules for the UI. Add to this file whenever a design choice is made or reversed so the next iteration doesn't relitigate it.

---

## Next Steps (subtask) cards

### Layout

- **Lay out vertically, never stacked or overlapping.** When a task is expanded, the subtask cards appear in a single vertical column below the source day, one per row, fully separated.
- **No fanned/tilted overlap.** Cards must not visually overlap each other — even when tilted. Tilt is removed (`tilt = 0`) so the cards stay rectangular and clearly distinct.
- **No staircase / margin-left offset.** Earlier iterations indented each successive card to the right (staircase effect). Don't bring this back — it makes the eye work harder and looks like a deck of cards.
- **Generous vertical spacing.** Use `gap: 32px` between cards in the `.subtask-stack` so corners never crowd each other.
- **Pane spans 3 day-columns.** The expanded `.subtask-pane.board-pane` is `width: calc(300% + 40px)`, anchored under the source day-card (or right-anchored if the source is in the last 2 days).

### Card dimensions & content

- **400×400 fixed.** Same size as day-cards.
- **Layout from top:** parent task title (light blue `#6ea7ff`) on the icon row → agent verb-title + send arrow → role subtitle → description → "Add to this task" input.
- **Checkbox upper-right corner.** Absolute positioned, 32×32.
- **Weekday tint.** Card background matches the source day's `.dow-*` color so users can tell at a glance which day a card came from.

### Multi-expansion

- Expanding a task on a different day does **not** collapse prior expansions. Multiple panes can be open at once.
- New cards adopt the source day's tint, making it obvious which task they belong to even when several are open.

---

## Day cards

- **Fixed 400×400.** Horizontal scroll allowed; scrollbar hidden.
- **"Add a task" input always visible** on every day-card (not just the selected one).
- **Date inline to the right of the weekday** — saves vertical space for the task list.
- **Weekday tint** via `.dow-*` classes — subtle but distinct.

---

## Theme

- **Light periwinkle (`#d8def5`)** background.
- **Subtle weekday tints** for day-cards (and matching subtask cards).
- **Signup form text white** with `#b8b8cc` placeholder; **Go button green (`#4caf50`)** when both fields filled.

---

## Header

- Single header row. **No second project bar** — all project switching, "+ New project" pill, and view toggles live in the app header.
- **+ New project pill** is labeled, not a tiny circle (discoverability).

---

## Keyboard

- **← / →** scrolls the selected day-card into view (`scrollIntoView({ inline: 'center' })`) and focuses its task input.
- **Type-to-focus:** any printable keystroke (no Ctrl/Meta/Alt) when no input is focused routes to the selected day's "Add a task" input.

---

## Persistence

- **localStorage session** (subdomain / slug / projectId) restores on reload.
- Tasks themselves persist server-side in SQLite. On Railway a volume is mounted at `/data` with `DB_PATH=/data/movealong.db`, so data survives deploys.
