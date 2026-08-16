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

## Ordering tasks

- **A task's rank is where it sits.** The 1/2/3 exclamation marks are gone
  (2026-08-14); there is no invisible priority level behind the order.
- **One drag gesture, two meanings, split by pointer position** within the row:
  the middle 40% links a series, the top and bottom 30% reorder. The series drag
  existed first, so it keeps the forgiving centre target.
- **The feedback must say which one you're getting** before you let go: a solid
  blue insertion line for a reorder, the row highlight for a series link, plus a
  `move` / `link` cursor. Two independent signals, because the two outcomes are
  very different and only one is undoable by eye.
- The line is an **inset box-shadow, not a border** — a border re-flows every row
  below it as the pointer crosses a zone boundary, which reads as the list
  flinching.
- **Or hover and press 1-9** to send a task to that slot; `0` sends it last. A
  day holds ten, so ten single-key presses cover every slot.
- Reordering is **same-day only.** Across day cards a drag still means "series",
  so nothing that already worked changed meaning.
- **A promoted step is the one thing the app places for you**, right under the
  task it came out of. Everything else appends to the bottom, and that default is
  worth protecting — but a row with an obvious home should land in it, not make
  the user go find it.
- **Don't bring back:** exclamation marks, or any sort that defers until
  mouse-leave — moving the row is now the whole point, so it happens on the
  keypress. A number press instead *holds* its task under the keyboard until the
  pointer moves.

## Subtask pane

- **One contained card**, listing up to 7 compact rows — check, assignee emoji,
  description, send arrow. Not one card per subtask.
- **Never wider than the day it hangs from.** It's absolutely positioned under
  its day column at `width: 100%`.
- **Single-pane rule: only one may be open at a time.** Every site that adds to
  `expandedTaskIds` must `clear()` it first. Same-day panes share coordinates,
  so two open at once silently occlude each other — this was a real bug.
- **Seven rows is the cap, and ↺ tops up rather than starting over.** Anything
  the user kept or typed survives; only slots freed by *ticking a step off* get
  refilled. There is deliberately no delete affordance on a row — completing one
  is the gesture that makes room, which keeps the pane honest about what's done.
- **Hover a row and ↑ promotes it onto the board** as a real task, landing on the
  parent task's day. That is the escape hatch when seven isn't enough, and its
  departure frees a slot. Hover-reveal, because the pane is only as wide as a
  200px day card.
- **Steps arrive drafted, then get researched.** Phase 1 reasons and returns in
  seconds so the user has something to think about; phase 2 searches the web and
  rewrites the rows in place. Researched rows read **light blue** — a row tint
  plus blue-tinted text, *never* blue text alone, because AI steps are full of
  `#0284c7` links and blue text around blue underlined links is unreadable.
- **Research is opt-in per board and costs money.** Off by default: at ~10¢ a
  researched task, auto-researching everything empties a $5 board in a week. The
  budget line under the board carries both the spend and the switch. A drafted
  step is a *finished* state, not a degraded one, so it gets no styling of its own.
- **A promoted step keeps a thread back to where it came from.** It lands
  directly under its source task and shows a **dot inside its completion
  circle**; hovering it tints the source row. It must read as a *peer* — same
  left edge, same circle, full task anatomy — because indenting or greying it
  would borrow the pane's own vocabulary for dependents and say the opposite of
  what's true. The dot yields the moment the circle has something else to say (a
  series countdown, the completed check): one slot, one meaning at a time.
- **Steps carry what they cost — as a range, never a figure.** A grey chip after
  the step text, the task total opposite the pane title. Whole dollars, the same
  reasoning as the whole-dollar budget: "$91.40–$127.75" claims a precision an
  estimate doesn't have. The chip links to its source where there is one and
  names what was priced in its tooltip, so the number is one click from being
  checked rather than something to take on faith.
- **The total says ≥ when anything is unpriced.** A step researched and found to
  cost nothing is an answer; a step with no estimate is a hole, and a total that
  quietly swallows it is a lie. Same instinct as the ↺ that tops up rather than
  wiping: never let the display imply completeness it doesn't have.
- **Two costs, never added together.** What the AI spent is metered to the cent;
  what the fence costs is a guess about the world. They can share a screen; they
  can't share a number.
- **Don't bring back:** 400×400 cards, a pane spanning three columns, tilt/fan
  overlap, staircase indenting, weekday tints, multiple panes open at once, or
  greyed-out "provisional" rows.

---

## Chrome

- **Quiet single-row header**, 44px min-height, blurred white bar. Everything in
  it whispers (grey, 12–13px) — nothing in the chrome should outrank a day
  header. Order: wordmark · + New project · project tabs · 🧠 Assistant ·
  🔎 Research · 📅 Calendar · view toggle · theme toggle · user·project chip ·
  ? help.
- **The bottom of the page is not navigation.** The AI-budget line that used to
  sit under the board is gone; its switch moved into the header and its budget
  editor onto Shift+Click. Anything worth clicking belongs in the one bar.
- **The view toggle is a single icon button**, showing the view you'd switch
  *to* — the same convention as the theme toggle beside it. Two labelled
  segments asked the user to read a control that only ever has two states.
- **Project tabs never move.** All tabs share one geometry so switching boards
  can't shift the row; `.active` carries no `font-weight`, because bolding the
  label widens that tab and nudges every tab after it.
- **Active tab in dark mode takes a white border** — the board you're on should
  read as lit against the slate bar.

## Icon

- **A white chevron on the accent blue** — the same forward arrow that moves a
  task to the next day, because that is the one gesture the product is about and
  a single shape is all that survives 16px in a tab.
- **It bleeds off all three ends.** Drawn to fit inside the tile it was a thin
  stroke on a mostly-blue square and read as a media "next" button; running it
  off the edges makes white half the mark. Chosen from eight variants judged at
  16px, not as large renders.
- **Pinned tabs are a separate channel.** Safari ignores the favicon there and
  reads `rel="mask-icon"`, a silhouette it tints itself — with none supplied it
  draws a letter taken from the *domain*. The mask drops the tile (a filled
  square pins as a blob) and pulls the chevron back inside the canvas.

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
- **Hover + a number is the app's number pad.** What it means depends on what the
  pointer is on: over a **row** it's a slot (`0` sends it last), over the **→
  arrow** it's days forward. Same key, read off the target — which is only
  honest because the arrow already meant "forward" when clicked.
- The more specific target wins the hit-test. The arrow sits *inside* the row, so
  it is tested first; anything nested inside a row that later wants digits has to
  slot in above it, not beside it.
- **Every hover+number holds its target under the keyboard** until the pointer
  actually moves, because acting on it moves it out from under the cursor. So
  `3` then `2` is five days, not two — repeat presses accumulate.
- **`0` on the arrow does nothing** rather than falling through to a reorder. A
  key that quietly does a *different* feature's job is worse than one that does
  nothing.
- **Hover + `r`** cycles a task's repeat.
- **Type-to-focus:** any printable keystroke with no input focused routes to the
  selected day's "Add a task" box. The digit and `r` branches are handled *above*
  this fallback, and all of them early-return when focus is in a field — so
  typing "3 eggs" never reorders anything.

## Time

- **A day key is a label, not an instant.** `YYYY-MM-DD` and every bit of
  arithmetic on it stays UTC-anchored, so a month of day math never drifts with
  DST.
- **But "today" is a local question**, and the only one. Deriving it from the
  server's clock made the board read Saturday at 9pm Friday in CST — the last
  six hours of every day were wrong. The browser answers it (`en-CA` formats as
  `YYYY-MM-DD` already) and tells the server its zone on every request.
- **Location, cheaply.** No geolocation prompt, no stored address, no schema
  column — a header the browser already knows, with UTC as the fallback so
  anything that isn't a browser behaves exactly as before.

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
