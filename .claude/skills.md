# Move Along Skills

## dev-server

Start the development server:
```bash
cd /Users/moon/MoveAlong/server && node src/server.js
```
Runs on port 3000. Kill existing process first if port is in use:
```bash
lsof -ti:3000 | xargs kill 2>/dev/null
```

## test-api

Quick smoke test of the API:
```bash
curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/api/companies -H 'Content-Type: application/json' -d '{"companyName":"Test Co","userName":"Tester"}'
```

## reset-db

Delete the database to start fresh (it auto-recreates):
```bash
rm -f /Users/moon/MoveAlong/server/movealong.db
```
Then restart the server.

## frontend-edit

The frontend is at `public/index.html`. After editing:
1. No build step needed
2. Just refresh `http://localhost:3000` in the browser
3. If server.js changed, restart the server

## project-layout

```
MoveAlong/
├── CLAUDE.md
├── .gitignore
├── public/
│   └── index.html          # Frontend (vanilla JS SPA)
├── server/
│   ├── src/
│   │   ├── server.js        # Express API (~500 lines)
│   │   └── db.js            # SQLite layer (~120 lines)
│   ├── package.json
│   └── movealong.db         # Auto-created, gitignored
├── reference/               # Design docs and specs
└── archive/                 # Old files, gitignored
```
