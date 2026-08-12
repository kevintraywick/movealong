# MoveAlong — Design Notes

Living document of design decisions, conventions, and "do / don't" rules for the
UI. Add to this file whenever a design choice is made or reversed so the next
iteration doesn't relitigate it.

> **Rewritten 2026-08-12.** Most of this file described the original prototype —
> 400×400 day cards, periwinkle background, a green Go button, subtask panes
> three columns wide, several panes open at once. Every one of those was
> reversed months ago. Entries below reflect the app as it actually is; the
> reversals are kept as explicit "don't bring this back" notes, because that's
> the part worth remembering.

---

## Palette

- **Accent is a sky-blue ramp:** `#38bdf8` bright · `#0ea5e9` fills · `#0284c7`
  dark hover · tints `#f0f9ff` / `#bae6fd`. Use blue for any new UI.
- **No green.** The original emerald accent is gone. The single sanctioned
  exception is the help page's handwritten margin notes (`#059669`), precisely
  *because* they should read as outside the app's palette.
- **Red (`#ef4444`) is semantic, never decorative.** It means overdue or
  deadline: overdue day panes, a locked task on its lock day, a board tab with
  something due, a day counter past 10.
  - Corollary, learned 2026-08-10: **priority marks are blue, not red.**
    Priority is a *ranking*, not a warning. Two unrelated red things on one task
    row diluted both.
- **Lock amber (`#f59e0b`)** for the deadline edge and 🔒 affordances.

## Type

- **One scale, 13px base.** Everything sits on ~11/12/13/14/15px. Don't
  reintroduce outsized text anywhere — the old split (22px shell around a 13px
  board) is gone.
- **One display face, used once:** the wordmark, Bricolage Grotesque 800 at
  17px. Don't use it anywhere else.

---

## Day cards

- **200px wide**, not 400. Horizontal scroll; scrollbar hidden.
- **"Add a task" input on every card**, not just the selected one.
- Today is blue. Overdue days (before today, only visible when a past-due lock
  pulls the calendar back) get a red border that must out-specify `.selected`.
- Day capacity is 10 pending tasks; the 11th overflows to the next day with room.

## Subtask pane

- **One contained card**, listing up to 7 compact rows — check, assignee emoji,
  description, send arrow. Not one card per subtask.
- **Never wider than the day it hangs from.** It's absolutely positioned under
  its day column at `width: 100%`.
- **Single-pane rule: only one may be open at a time.** Every site that adds to
  `expandedTaskIds` must `clear()` it first. Same-day panes share coordinates,
  so two open at once silently occlude each other — this was a real bug.
- **Don't bring back:** 400×400 cards, a pane spanning three columns, tilt/fan
  overlap, staircase indenting, weekday tints, or multiple panes open at once.

---

## Chrome

- **Quiet single-row header**, 44px min-height, blurred white bar. Everything in
  it whispers (grey, 12–13px) — nothing in the chrome should outrank a day
  header. Order: wordmark · + New project · project tabs · Calendar/List toggle ·
  🧠 switch · theme toggle · user·project chip.
- **Project tabs never move.** All tabs share one geometry so switching boards
  can't shift the row; `.active` carries no `font-weight`, because bolding the
  label widens that tab and nudges every tab after it.
- **Active tab in dark mode takes a white border** — the board you're on should
  read as lit against the slate bar.

## Popups

- **One box for all of them.** `.team-popup` is the floating card;
  `.lock-popup-menu` / `.lock-opt` are its rows. The lock popup, the account
  popup (sign out) and the board popup (delete board) all use it.
- **Prefer an existing idiom to a new primitive.** Before inventing a
  selection or hit-testing model, check whether one of these already covers it:
  hover-reveal icon (`.task-lock`, `.task-unlink`), hover + keypress (priority
  1/2/3), or click-to-popup (lock, account, board). Unlink shipped as a
  hover-reveal ✂️ instead of clickable SVG threads for exactly this reason.
- **Spend a click that's currently doing nothing.** Deleting a board hangs off
  clicking the tab you're *already on* — previously a no-op — so it cost no new
  affordance and stays one deliberate step off the main path.

## Dark mode

- One `body.dark` override block at the end of the stylesheet. Slate palette
  (bg `#0f172a`, cards `#1e293b`, borders `#334155`, text `#e2e8f0`); accent
  blue, semantic red and lock amber survive unchanged.
- The toggle icon shows the theme you'd switch **to**.
- **Any new component with a light background needs an override added.**
- **Overrides must out-specify what they fight.** `body.dark .thing` is (0,2,1)
  and loses to a compound like `.thing.a.b` (0,3,0). This has bitten twice —
  the signup project field and `.lock-opt`.

---

## Keyboard

- **← / →** scrolls the selected day card into view and focuses its task input.
- **Type-to-focus:** any printable keystroke with no input focused routes to the
  selected day's "Add a task" box. Priority digits are handled *above* this
  fallback, and both early-return when focus is in a field — so typing
  "3 eggs" never sets a priority.

## Persistence

- **localStorage session** (subdomain / slug / projectId) restores on reload.
  Sign out clears just that key; theme, AI key and hint state survive.
- Tasks persist server-side in SQLite. On Railway a volume is mounted at `/data`
  with `DB_PATH=/data/movealong.db`, so data survives deploys.

---

## Motion

- **Help-page vignettes** are looping pure-CSS mini-scenes built from one
  vocabulary and one storyline (building a backyard fence). Rules that cost real
  debugging time live in CLAUDE.md; the short version: never stagger an infinite
  loop with `animation-delay`, pin `opacity` at every visible keyframe, and
  anchor animated cursors inside their click target.
- **Each vignette is also a standalone file** under `docs/animation/`,
  regenerated from `help.html` by `build.js` — never hand-copied, so they can't
  drift.
- **The :60 commercial** (`docs/commercial/one-minute-in-script.md`, animatic at
  `docs/animation/one-minute-in.html`) is driven by a single `render(t)` master
  clock rather than CSS animation, so it retimes from one object and captures
  deterministically. Its principle: pure UI, no generated people or b-roll — the
  product's credibility is its precision, and stock-SaaS imagery would spend it.
