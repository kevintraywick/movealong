#!/usr/bin/env node
// Fills in the Message-ID of each row on the board's mail strip, read from
// Apple Mail's own files, so the board's Open can open the email in Mail
// with a message:// link (Kevin, 2026-10-01). The Gmail connector never shows
// the Message-ID header, but Kevin's Gmail is also in Apple Mail, which keeps
// every message as an .emlx file and indexes them in "Envelope Index".
//
// heartbeat.sh runs this after every pass. It only reads Mail's files and
// only writes message_id on the board. A row it can't match keeps Gmail.
//
//   node scripts/tom/mail-ids.mjs        one line on what it matched

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const MAIL = join(HOME, 'Library/Mail');
const WINDOW = 900;   // seconds between Gmail's date and Mail's date_received

// The board's address and key are the ones the MoveIt server is registered with.
const env = ((JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8')).mcpServers || {}).movealong || {}).env || {};
const { MOVEALONG_URL: url, MOVEALONG_TEAM: team, MOVEALONG_USER: user, MOVEALONG_AI_KEY: key } = env;
if (!url || !team || !user) { console.log('mail-ids: no board address in ~/.claude.json'); process.exit(0); }
const headers = { 'content-type': 'application/json', ...(key ? { 'x-ai-key': key } : {}) };

const version = existsSync(MAIL) ? readdirSync(MAIL).filter(d => /^V\d+$/.test(d)).sort((a, b) => a.slice(1) - b.slice(1)).pop() : null;
const index = version && join(MAIL, version, 'MailData/Envelope Index');
if (!index || !existsSync(index)) { console.log('mail-ids: no Apple Mail index'); process.exit(0); }

function sql(q) {
  // immutable=1: read without taking Mail's lock; a second's staleness is fine.
  const out = execFileSync('sqlite3', ['-readonly', '-separator', '\t', `file:${index}?immutable=1`, q], { encoding: 'utf8' });
  return out.trim() ? out.trim().split('\n').map(l => l.split('\t')) : [];
}
const quote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// imap://<account>/%5BGmail%5D/All%20Mail → <account>/[Gmail].mbox/All Mail.mbox/<store>/Data
function dataDir(mailboxUrl) {
  const m = /^[a-z]+:\/\/([^/]+)\/(.+)$/i.exec(mailboxUrl || '');
  if (!m) return null;
  const box = join(MAIL, version, m[1], ...m[2].split('/').map(p => decodeURIComponent(p) + '.mbox'));
  if (!existsSync(box)) return null;
  const store = readdirSync(box).find(d => existsSync(join(box, d, 'Data')));
  return store ? join(box, store, 'Data') : null;
}

// Mail files message 98298 under Data/8/9/Messages: the thousands, digit by
// digit from the right.
function emlxPath(data, rowid) {
  const k = Math.floor(rowid / 1000);
  const dir = join(data, ...(k ? String(k).split('').reverse() : []), 'Messages');
  return [`${rowid}.emlx`, `${rowid}.partial.emlx`].map(f => join(dir, f)).find(existsSync) || null;
}

function headerId(file) {
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(65536);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  const head = buf.toString('utf8', 0, n).split(/\r?\n\r?\n/)[0];
  const m = /^message-id:[ \t]*(?:\r?\n[ \t]+)?<([^>\s]+)>/im.exec(head);
  return m ? m[1] : null;
}

function findId(row) {
  const addr = (row.sender_addr || '').toLowerCase();
  const t = Math.floor(Date.parse(row.received_at || '') / 1000);
  if (!addr || !t) return null;
  const hits = sql(`SELECT m.ROWID, mb.url FROM messages m
    JOIN addresses a ON a.ROWID = m.sender JOIN mailboxes mb ON mb.ROWID = m.mailbox
    WHERE lower(a.address) = ${quote(addr)} AND m.date_received BETWEEN ${t - WINDOW} AND ${t + WINDOW}
    ORDER BY abs(m.date_received - ${t}) LIMIT 5`);
  for (const [rowid, box] of hits) {
    const data = dataDir(box);
    const file = data && emlxPath(data, Number(rowid));
    const id = file && headerId(file);
    if (id) return id;
  }
  return null;
}

const res = await fetch(`${url}/api/companies/${team}/users/${user}/inbox`, { headers });
if (!res.ok) { console.log(`mail-ids: board said ${res.status}`); process.exit(0); }
const { items = [] } = await res.json();
const todo = items.filter(m => !m.message_id);
let found = 0;
for (const m of todo) {
  let id = null;
  try { id = findId(m); } catch (e) { console.log(`mail-ids: ${e.message.split('\n')[0]}`); break; }
  if (!id) continue;
  const put = await fetch(`${url}/api/inbox-items/${m.id}`, { method: 'PUT', headers, body: JSON.stringify({ message_id: id }) });
  if (put.ok) found++;
}
console.log(`mail-ids: ${found} of ${todo.length} rows matched in Apple Mail`);
