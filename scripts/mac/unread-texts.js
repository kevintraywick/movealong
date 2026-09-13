#!/usr/bin/env node
// Unread texts on this Mac, for the morning briefing (2026-09-13).
//
//   node scripts/mac/unread-texts.js            # unread, last 24h, as JSON
//   node scripts/mac/unread-texts.js --hours 48
//
// Reads ~/Library/Messages/chat.db directly (read-only). Needs Full Disk
// Access for the app running this — Terminal, or whatever hosts Claude Code —
// under System Settings › Privacy & Security › Full Disk Access; without it
// macOS says "authorization denied" and this script says so and exits 3.
// Messages are grouped by thread; the phone/email handle is what text.js
// takes back, so a briefing item can carry an sms: link straight to a reply.
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const hoursArg = process.argv.indexOf('--hours');
const hours = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) || 24 : 24;
const db = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
// chat.db dates are nanoseconds since 2001-01-01.
const since = `(strftime('%s','now') - ${Math.round(hours * 3600)} - 978307200) * 1000000000`;
const sql = `
  SELECT h.id AS handle, COALESCE(c.display_name, '') AS chat_name,
         m.text, m.is_read, m.date
  FROM message m
  JOIN handle h ON h.ROWID = m.handle_id
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  LEFT JOIN chat c ON c.ROWID = cmj.chat_id
  WHERE m.is_from_me = 0 AND m.is_read = 0 AND m.text IS NOT NULL AND m.text != ''
    AND m.date > ${since}
  ORDER BY m.date ASC`;
let out;
try {
  out = execFileSync('sqlite3', ['-json', '-readonly', db, sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  const msg = String(err.stderr || err.message);
  if (/authorization denied|unable to open/i.test(msg)) {
    console.error('Cannot read Messages: grant Full Disk Access to this terminal (System Settings › Privacy & Security › Full Disk Access), then rerun.');
    process.exit(3);
  }
  console.error(msg); process.exit(1);
}
const rows = out.trim() ? JSON.parse(out) : [];
const threads = new Map();
for (const r of rows) {
  const key = r.chat_name || r.handle;
  if (!threads.has(key)) threads.set(key, { from: key, handle: r.handle, messages: [] });
  threads.get(key).messages.push({ text: r.text, at: new Date(r.date / 1e6 + 978307200000).toISOString() });
}
console.log(JSON.stringify({ hours, unread: rows.length, threads: [...threads.values()] }, null, 2));
