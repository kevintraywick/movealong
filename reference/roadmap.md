# Roadmap

## Done
- [x] Express API with full CRUD for companies, users, tasks
- [x] SQLite database with sql.js (no native deps)
- [x] Single-page frontend with dark theme
- [x] 30-day calendar board with horizontal scroll
- [x] Task assignment between team members
- [x] Task return-to-sender flow
- [x] User switcher for viewing other boards
- [x] Keyboard navigation (arrow keys between days)
- [x] Help bar with keyboard shortcuts (compact single-row redesign)
- [x] Past task spillover to today (backend-side)
- [x] Lock tasks to a date (deadlines) — anchor pulls the calendar back to a past-due lock date
- [x] Red border on overdue day panes (days before today when a locked task pulls the row back)
- [x] AI assistant master on/off switch (auto-generate subtasks on task add)
- [x] Sky-blue theme refresh; single-list subtask pane capped to day width
- [x] Day counter — small grey count of days a task has been pushed forward (via immutable `origin_date`)
- [x] Day counter turns red past 10 days (lagging items)
- [x] Locked task on its lock day renders red
- [x] Series (task chains): drag-to-link, countdown circles, hover threads, move/spillover cascade with lock-stop

## Next
- [ ] Series: unlink UI (currently only re-drag/assign/delete removes a step)
- [ ] Authentication (currently URL-based access only)
- [ ] Subdomain routing (DNS wildcard + proxy for *.movealong.com)
- [ ] Rate limiting for public deployment
- [ ] Task deletion from UI
- [ ] Mobile-responsive layout
