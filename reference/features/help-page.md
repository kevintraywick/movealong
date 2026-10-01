# The help page

> Read when touching help.html vignettes, margin notes or docs/animation. Moved out of CLAUDE.md verbatim on 2026-09-30; keep adding here, not there.

### Vignettes and margin notes
- **Help-page vignettes (`help.html`):** looping pure-CSS mini-scenes in column 2 of the `three-col` grid, shared vocabulary (`.mini-card`/`.mini-task`/`.mini-circle`/`.mini-day`, real dates via `data-day-offset`, one storyline: a backyard fence). Section order: The board (Add · Move forward · **Lock a deadline** · Complete/postpone · Overflow · Projects) → **More fun** (Links, Prioritize, **Repeat**, **Goal for the day**, Create lists, **Dark mode**, **Focus on one day**) → Power moves → Subtasks → **Add calendar events (Beta)** → Run your own copy → Enabling real AI steps.
  - **A demo can claim column 3** (`.card.demo.demo-3`) when the card's point *is* a comparison (Projects' deadline-flagged tab bar, Dark mode's dark still). Under 760px it falls back to `grid-column: auto`.
  - **The two light/dark stills hard-code their own chrome colours**; each must keep its theme in *both* modes.
  - **Scene CSS declared above the `.nav-ring` block must compound its selectors** (`.nav-ring.spill-ring`, and its `ellipse` animation override); `.scissors-ring` only works bare because it's declared after. Cost two debugging rounds. The theme toggle sits **right** of "← Back to your board".
  - **Never stagger elements in an infinite loop with `animation-delay`** — it phase-shifts the element against the scene's fade. Give each its own `@keyframes` with percentage offsets on the same duration (`stepIn1..5`, `clock1..3`).
  - **Pin `opacity` (and any reset property) at every visible keyframe.** A property keyed only in the last frames interpolates from its implicit start across the ENTIRE cycle.
  - **Anchor animated cursors inside their click target** (`top:50%; left:50%`; the rest position is an offset in keyframes). Absolute scene coordinates misaligned twice.
  - **Red attention ring** = an SVG `<ellipse pathLength="100">` in a `.nav-ring` svg inside the target, drawn by animating `stroke-dashoffset` (`ringDraw`), tilted a few degrees. Resize per target with a second class.
  - Every scene needs `prefers-reduced-motion` end-state overrides; scenes stay light in dark mode.
- **Margin notes (help page, column 3):** `.margin-note` = hand-drawn SVG arrow + handwriting stack (`Bradley Hand`/`Segoe Print`/`Comic Sans MS`/cursive), Kevin's first-person voice. Default **green `#059669`** (`#34d399` dark) — the one sanctioned green, approved 2026-08-05, because they should read as outside the palette. `.margin-note.important` = red `#ef4444`. `grid-column: 3`, `display: none` under 760px. Source order decides the row.
- **Every help vignette also lives standalone in `docs/animation/`** plus an `index.html` contact sheet, **generated** by `node docs/animation/build.js` from `help.html` (source of truth). Each extract embeds the *entire* stylesheet (~58 KB/file) for pixel identity. Rerun after touching any scene.

### Borrowing keyframes
- **A help-page scene can borrow another scene's keyframes** when the motion is the same (the goal vignette reuses `prioShift1/2`, `keyPop`, `prioCursor`, defines only `goalRise`). Element classes still need their own names (the reduced-motion block keys on them) and their own `sceneFade`.
