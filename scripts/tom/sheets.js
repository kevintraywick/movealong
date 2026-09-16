// Append rows to a Google Sheet with a service account — no library, no
// gcloud. Node's crypto signs the RS256 JWT; two fetches do the rest.
//
// Setup (Kevin's step, once): create a service account in Google Cloud with
// the Sheets API enabled, download its JSON key to
//   ~/.config/tom/google-service-account.json   (chmod 600)
// and share the ledger sheet with the service account's email (Editor).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_PATH = process.env.TOM_GOOGLE_KEY || path.join(process.env.HOME, '.config', 'tom', 'google-service-account.json');

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }

async function accessToken() {
  if (!fs.existsSync(KEY_PATH)) throw new Error(`no Google service-account key at ${KEY_PATH}`);
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key.private_key);
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function readColumn(sheetId, range, token) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (j.error) throw new Error('read failed: ' + j.error.message);
  return (j.values || []).map(v => v[0]);
}

// Appends one row unless a row with the same value in column B (invoice #)
// already exists. Returns 'appended' | 'exists'.
async function appendRow(sheetId, row, { tab = 'Sheet1', keyCol = 'B' } = {}) {
  const token = await accessToken();
  const existing = await readColumn(sheetId, `${tab}!${keyCol}:${keyCol}`, token);
  if (existing.includes(row[1])) return 'exists';
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab + '!A:H')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  const j = await r.json();
  if (j.error) throw new Error('append failed: ' + j.error.message);
  return 'appended';
}

module.exports = { appendRow, KEY_PATH };
