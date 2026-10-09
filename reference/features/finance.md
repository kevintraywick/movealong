# Finance pane

> Read when touching the finance pane on /dashboard, `server/public/finance.js`, the `finance_*` tables or Tom's finance tip. Built 2026-10-09 from `finance-dashboard-mockup.html` (repo root), which is the design source and stays as a reference.

### What it is
- **A pane beside Health on /dashboard.** Layout is `.cols` (two equal columns, one below 1040px): the left column stacks the **unchanged** Health and Completed panes, the right is `#financePane`. Kevin's rule: **only resize the Health and Completed panes, never restyle them** — the first mockup invented a stand-in and he sent it back.
- **Four balances a day** — Cash, Savings, Debt, Trading (the E-Trade account) — in one entry row (‹ Oct 9 ›, four `$` fields, a saved word, the **+** statement drop at the end). Autosaves; a blank clears the field (unentered is not zero). Defaults to **today**, not yesterday.
- **The last 30 days:** one box a day, **blue if anything was entered, light blue if not**. No count scheme, no key. Click a day to fill it in.
- **One row for a tip or an alert**, written by Tom, with **Useful / Not for me**. No heading, no arithmetic in it (Kevin: "it doesn't need to calculate cash following the alert").
- **Stat cards, no subtext:** Net (cash + savings − debt), Debt-free date, Debt left, Savings, House fund (with a thin bar).
- **Next 60 days:** 30 back, 30 ahead. **Bars of net: orange when cash + savings exceed debt, blue when debt is ahead**, faded where a day has no entry (interpolated), dashed outline where projected. A violet dashed line is the plan with planned spending in it. **Next 12 months uses the same format, weekly (52 bars)**, with a "debt-free" marker. Colours are the dashboard palette's validated blue/orange/violet (red only on alerts).
- **What if I spend…:** planned spending rows (tick, label, date, amount, monthly) feed the violet line and a one-line effect by Dec 31. **Assumptions** (income, daily spend, debt APR, monthly moves to savings and the house fund, house goal, rates) and **recurring bills** (one can be marked "pays debt") sit in a disclosure; they drive the projection and **default to 0**, so an unset one counts for nothing.

### How it works
- **The page projects, the server stores.** `finance.js` (one file, shadow DOM so the dashboard's `.stat` / `.legend` / `.entry` styles can't leak in or out; dark mode follows `body.dark` through a MutationObserver) walks forward from the last day with cash, savings and debt entered: pay on the 1st and 15th, daily spend, bills on their days, daily interest, the monthly savings/house moves. Trading is optional and only counts with the "include trading account" tick.
- **Tables:** `finance_entries` (one wide row per user-day, NULL = unentered), `finance_plan` (one JSON blob of assumptions, bills, planned spending), `finance_tips` (kind tip|alert, body, feedback up|no|replaced), `finance_statements` (metadata; **files live in `statements/` beside the database, never in it** — every request exports the whole DB).
- **Routes** (all under `/api/companies/:sub/users/:slug/finance` unless noted): `GET` (60 days of entries, plan, the unanswered tip, statements); `PUT entries/:day` (future days refused; cash may be negative, the rest not); `PUT plan` (replaced whole, sanitised); `POST|GET tips`; `POST statements` (raw body, `x-filename`, pdf/csv/ofx/qfx/txt, 15 MB); `PUT /api/finance/tips/:id {feedback}`; `GET /api/finance/statements/:id/file`; `DELETE /api/finance/statements/:id`.
- **Private by login:** it sits behind the site login (`SITE_USER` / `SITE_PASSWORD`, see CLAUDE.md). Tom reaches the files with his `x-ai-key`.

### Tom
- **MCP:** `get_finance` (entries, plan, recent tips **with Kevin's answers**, statement file URLs), `log_finance`, `post_finance_tip`, `finance_recipe`. **Step C of the heartbeat recipe** posts one tip or alert, skips if one posted in the last 20 hours is unanswered, and is told to learn from the Useful / Not for me answers: no repeats of kinds he rejected, more of the kinds he liked. Scope on purpose: dated alerts, spending patterns, saving habits, idle money, strategies he isn't using, how a small daily change moves the debt-free date.
- **Not built yet:** Tom reading the statement files into balances (the whole point of the drop zone is fewer morning numbers); a "how Kevin handles money" learned list like the how-you-work lines.

### Gotchas
- The mockup's sample figures were invented; the real pane starts empty and says so ("Enter cash, savings and debt for a day…").
- `isFull()` means cash + savings + debt, not all four.
- Don't put a backtick in the CSS/markup strings in `finance.js` — they are template literals generated from the mockup.
