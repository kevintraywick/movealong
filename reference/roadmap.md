# Roadmap

## Done
- [x] Express API with full CRUD for companies, users, tasks
- [x] SQLite database with sql.js (no native deps)
- [x] Single-page frontend with dark theme
- [x] 30-day calendar board with horizontal scroll
- [x] Task assignment between team members
- [x] Accept / return on assigned tasks (awaiting-inbox state, 2026-08-20)
- [x] Shared boards + team view (demo team: Margo, Jay, Yarwen)
- [x] Whole-task forward gesture (👤 on the row) + Tessa the AI teammate (auto-accepts)
- [x] Task pages (/task/:id) — background, notes feed, results; Option+Click on the task name
- [x] Finished handovers come home for review — "From teammates" section; tick / reclaim ↑ / send back ↩ / reassign 👤
- [x] Task return-to-sender flow
- [x] User switcher for viewing other boards
- [x] Keyboard navigation (arrow keys between days)
- [x] Help bar with keyboard shortcuts (compact single-row redesign) — replaced 2026-09-03 by the tip bar: hovered element's tooltip shows in the footer
- [x] Past task spillover to today (backend-side)
- [x] Lock tasks to a date (deadlines) — anchor pulls the calendar back to a past-due lock date
- [x] Red border on overdue day panes (days before today when a locked task pulls the row back)
- [x] AI assistant master on/off switch (auto-generate subtasks on task add)
- [x] Sky-blue theme refresh; single-list subtask pane capped to day width
- [x] Day counter — small grey count of days a task has been pushed forward (via immutable `origin_date`)
- [x] Day counter turns red past 10 days (lagging items)
- [x] Locked task on its lock day renders red
- [x] Series (task chains): drag-to-link, countdown circles, hover threads, move/spillover cascade with lock-stop
- [x] Hyperlink tasks — URLs in task text open in a new tab; completing a link task closes its pane
- [x] Manual order — drag a task to a row edge (blue insertion line), or hover and press 1-9; replaced the 1/2/3 priority marks 2026-08-14
- [x] Series: unlink — hover a chained task for a ✂️ that cuts its link to its predecessor
- [x] AI subtask default lowered to 7 (prompt asks 5-7; endpoint hard-caps AI + mock lists)
- [x] ↺ "Regenerate all steps" pinned to the subtask pane's top-right corner
- [x] Header rework: "Main" → "List", +New project brand-styled beside the wordmark, project tabs clustered together, new-board button removed
- [x] List view shows locked task dates in red (master route returns `locked`)
- [x] Help page: animated CSS vignettes for every board feature (backyard-fence storyline), three-column layout with handwritten margin notes (green + red variants), dark mode synced with the board's theme key
- [x] Completed subtasks disappear from the pane (server keeps them for List-view progress counts)
- [x] Completing any task closes its subtask pane (was gated to hyperlink tasks)
- [x] Quick lists: "list …" tasks get a My-list pane (3 blank slots, grows as filled) above standard AI suggestions; ↑ moves a suggestion onto the list; regeneration preserves the user's items
- [x] Help page: "More fun" section (Links, Prioritize, Create lists + list vignette); series copy uses next-step language, not parent/child
- [x] New-project modal focuses the name field on open (Safari visibility-transition fix)

- [x] Promoted steps land under the task they came from, with a dotted circle and a hover tint on the source row
- [x] Step costs — material/labour/service ranges per subtask from the research pass, Haiku cost-triage to focus the search budget, task total with `≥` when anything is unpriced

- [x] Day capacity 7 (was 10); locking onto a full day still allowed (2026-09-02)
- [x] The brief — per-person + per-board standing notes for the assistant, triage-filtered per task, usage-sorted, agent "wish I knew" inbox, draft-from-tasks (2026-09-02)

## Next
- [ ] **Feedback loop on any task** (very soon, Kevin 2026-09-02) — a way to say how a task or its steps went, feeding the brief
- [ ] History: a page per day — a dashboard of what got done, visually interesting enough to gamify completion; most days simple, with links out to richer task outputs
- [ ] Task outputs beyond text — a recipe page (with a later rating), a trip map (drive to BNA, fly to NYC, back), images, video, reports, dashboards; decide how completion is recorded and where outputs live
- [ ] The board as "Alfred": an ongoing loop whose goal is to get better at helping this person — a frequent flyer's board starts hunting fares and points; a cook's offers to keep the recipe book. The brief is the memory this writes to
- [ ] Brief: spending — policy lines in the brief + money held elsewhere (per-task Stripe Issuing virtual card with a cap, or an approve-to-pay review row). Nothing to store until an agent can spend
- [ ] Brief: contacts — people in the user's life with email/phone/Discord, included in steps when it helps (back-burnered until real-world use; privacy story needs auth first)
- [ ] Brief: tool/agent dispatch — OpenShot/Resolve/HyperVideo/Nano Banana keys become usable once the agent can drive tools, not just research
- [ ] Authentication (currently URL-based access only)
- [ ] Subdomain routing (DNS wildcard + proxy for *.movealong.com)
- [ ] Rate limiting for public deployment
- [ ] Task deletion from UI
- [ ] Mobile-responsive layout
