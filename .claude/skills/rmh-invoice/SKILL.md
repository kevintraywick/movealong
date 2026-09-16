---
name: rmh-invoice
description: Draft Kevin's monthly RMH consulting invoice — build the PDF, log it in the receivables ledger, and leave a Gmail draft for his review. Use when a task says "send my RMH invoice", "RMH invoice", "invoice RMH", or the month's invoice is due (the 1st).
---

# RMH invoice (Tom's first skill)

Kevin invoices Retail Management Hero on the **1st of every month**: a fixed
retainer plus the **previous month's** additional hours at his hourly rate,
plus expenses. He used to duplicate last month's Pages file and edit it by
hand. This skill builds the PDF from a config, records it, and drafts the
email. **Tom drafts; Kevin sends** — never send the email yourself unless he
has granted that for this task in so many words.

## What you need before running

1. **The month** being invoiced (`YYYY-MM`). Default: the month the 1st falls
   in — if today is Sept 28 or Oct 1, that's `2026-10`. Confirm if unclear.
2. **Additional hours** for the previous month. Kevin adds these up himself;
   **ask him** ("How many additional September hours?") unless the task text
   or its notes already say. Never guess hours.
3. **Expenses** (default 0). Ask only if the task mentions any.
4. **Recipient email.** `scripts/tom/clients/rmh.json` has `email: null`
   until it's learned. Find it by searching Gmail for the last sent
   "RMH … Invoice" thread and reuse that recipient, then write it into the
   config so the next month doesn't have to look.

## Steps

1. Build the PDF and ledger row (from the repo root):
   ```
   cd scripts/tom && npm install    # first time only
   node invoice.js --client rmh --month 2026-10 --hours 27.7 --expenses 0 --json
   ```
   It writes `…/RMH/Invoices/<year>/RMH <Mon> <year> Invoice.pdf` (same
   naming as every past invoice), refuses to overwrite an existing one (pass
   `--force` if Kevin says redo), and records the invoice in the ledger
   (`ledger.csv` beside the invoices — the record) and regenerates
   `ledger.html` beside it — the view Kevin opens in Safari. Read the JSON
   back for the path, total and ledger status.
2. **Check the numbers against the pattern** before drafting: retainer
   2,100.00; hours × 225; the label reads "Additional <previous month>
   hours". If a value looks off, stop and ask.
3. **Create the Gmail draft** with the PDF attached (base64 the file for the
   Gmail connector's `attachments`): to the recipient above, subject
   `RMH <Mon> <year> Invoice`, a short body in Kevin's voice (see the last
   sent invoice thread for his wording; default: "Hi Lisa, attached is the
   <Month> invoice. Thank you! Kevin").
4. **Report back on the task**: put the draft link, the PDF path and the
   total into the task's Results (`set_results` on the MoveIt server) and a
   one-line note. Do **not** tick the task — sending is Kevin's step, and
   the review row is where he says it's done.

## Facts (verified 2026-09-16 from the 2025–2026 invoices)

- Retainer $2,100; rate $225/h; dated the 1st; invoice # `RMH <Mon> <year>`
  with Kevin's month spellings: Jan Feb Mar Apr May June July Aug Sept Oct
  Nov Dec.
- Files live in `/Users/moon/Library/Mobile Documents/com~apple~CloudDocs/MOVE_37/CONSULTING/RMH/Invoices/<year>/`.
- Bill to: Lisa Jackson, Retail Management Hero, Inc.
- **The ledger is `ledger.csv` + `ledger.html` in the Invoices folder** — no
  Google, no server (Kevin's call, 2026-09-16). Seeded from every 2025–2026
  invoice PDF; Feb 2025, Dec 2025 and July 2026 exist only as Pages files,
  so their amounts are blank. Every seeded row is `open` until marked.
  Changes are commands, never edits to the page:
  `node scripts/tom/ledger.js paid "RMH Sept 2026" 2026-09-20`,
  `node scripts/tom/ledger.js paid-through 2026-08-01` (everything dated on
  or before, date unknown), `node scripts/tom/ledger.js open` (regenerate and
  open in Safari). When Kevin says an invoice was paid, run the command.
- Layout: `scripts/tom/invoice.js` (pdfkit, Helvetica, one sky-blue accent
  bar). Sample render in `scripts/tom/samples/`. Change the look there, not
  per invoice.
