# Move Along

A task-management app that moves ideas into action and reduces decision fatigue. Add a task and AI immediately breaks it into specific, actionable steps — with real links, prices, and decisions surfaced — so you can act instead of plan. Postpone, complete, lock to a deadline, chain into series, prioritize, or hand a step to an AI agent, each with a single click or keypress.

Built deliberately simple so you can fork it and make it your own: a vanilla-JS single-file frontend, a small Express API, and SQLite with zero native dependencies. No build step, no framework, three npm packages.

## Features

- **30-day calendar board** with horizontal scroll; overdue tasks spill forward to today automatically
- **AI-generated subtasks** — adding a task opens a pane of up to 10 concrete steps (Anthropic API; falls back to mock steps without a key)
- **Series (task chains)** — drag a task onto another to sequence them; countdown circles, hover threads, cascading reschedules, ✂️ to unlink
- **Deadlines** — lock a task to a date; locked tasks never spill, and overdue locked work pulls the board back to it
- **Priorities** — hover a task, press 1/2/3 for red urgency marks; the list re-sorts
- **Hyperlinked tasks** — URLs in task text become clickable links
- **Day counters** — see how many days each task has been pushed forward
- **Multi-user assignment** — assign tasks or single steps to teammates or AI agents
- **Projects** — as many boards as you want per user, plus a "Main" page grouping everything by project

## Quick Start

```bash
cd server
npm install
npm start          # or: npm run dev  (auto-restart on change)
```

Open `http://localhost:3000`. That's the whole setup — the server serves both the API and the frontend, and the database file creates itself on first run.

## Environment Variables

All optional:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables real AI subtask generation (`claude-sonnet-5`). Without it you get mock subtasks. |
| `PORT` | `3000` | Server port |
| `DB_PATH` | `./movealong.db` | SQLite file location |
| `AI_LIMIT_PER_IP_HOUR` | `20` | Max AI generations per client IP per hour (over the cap serves mock steps) |
| `AI_LIMIT_GLOBAL_DAY` | `200` | Max AI generations per day across all users — a hard ceiling on API spend |

Requires Node.js ≥ 18 (native `fetch`).

## Deploying

Any Node host works. On Railway/Render/Fly:

1. Set the start command to `npm start` in `server/`.
2. Attach a **persistent volume** and point `DB_PATH` at it (e.g. mount at `/data`, set `DB_PATH=/data/movealong.db`). Without a volume, every deploy wipes the database.
3. Optionally set `ANTHROPIC_API_KEY` for real AI subtasks.

> **Cost warning:** there is no authentication. If you deploy publicly with an `ANTHROPIC_API_KEY`, anyone who finds your URL can trigger AI calls billed to you. The per-IP and daily rate limits above cap the worst case — keep `AI_LIMIT_GLOBAL_DAY` at a number you'd be comfortable paying for daily, or don't set a key on public deployments.

## Project Structure

```
server/public/index.html   Frontend — single file, inline CSS + JS, no build step
server/src/server.js       Express API
server/src/db.js           SQLite layer (sql.js — pure JS, no native compilation)
server/src/ai.js           Anthropic API client for subtask generation
reference/                 API reference, data model, roadmap
CLAUDE.md                  Working notes for AI-assisted development on this repo
```

## Design Choices & Known Limits

Simplicity is the point; these are deliberate trade-offs, fine for personal/small-team use:

- **No authentication** — boards are reachable by URL. Add auth before storing anything sensitive.
- **sql.js keeps the whole database in memory** and rewrites the file on change (atomically, once per request). Great up to tens of MB of tasks; if you outgrow it, swapping `db.js` to `better-sqlite3` is the upgrade path.
- **Single-file frontend** — ~3,700 lines of vanilla JS with clearly sectioned CSS, state, rendering, and handlers. Easier to fork and read top-to-bottom than a framework build; not built for a large frontend team.
- **No test suite** — manual testing against `http://localhost:3000`.

## License

MIT — fork it, strip it for parts, build your own. See [LICENSE](LICENSE).
