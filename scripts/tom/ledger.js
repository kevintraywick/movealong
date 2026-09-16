#!/usr/bin/env node
// The receivables ledger: a CSV beside the invoices is the record, and an
// HTML page beside it is the view (Kevin opens it in Safari; no Google, no
// server — 2026-09-16). Changes go through commands, not the page:
//
//   node ledger.js                                  regenerate ledger.html
//   node ledger.js paid "RMH Sept 2026" [YYYY-MM-DD] mark paid (default today)
//   node ledger.js paid-through YYYY-MM-DD           mark every invoice dated on/before paid (date unknown)
//   node ledger.js open                              regenerate and open in Safari
//   node ledger.js --client rmh …                    (rmh is the default)
//
// invoice.js calls append() + render() after writing a PDF.

const fs = require('fs');
const path = require('path');

const HEADER = ['date', 'invoice', 'client', 'hours', 'amount', 'status', 'paid_on', 'pdf'];

function loadClient(key) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'clients', key + '.json'), 'utf8')); }
function csvPath(client) { return path.join(client.invoices_dir, 'ledger.csv'); }
function htmlPath(client) { return path.join(client.invoices_dir, 'ledger.html'); }

function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const cell = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

function read(client) {
  const p = csvPath(client);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).slice(1).map(l => {
    const v = parseLine(l); const r = {}; HEADER.forEach((h, i) => r[h] = (v[i] || '').trim()); return r;
  });
}
function write(client, rows) {
  rows.sort((a, b) => (a.date + a.invoice).localeCompare(b.date + b.invoice));
  fs.writeFileSync(csvPath(client), HEADER.join(',') + '\n' + rows.map(r => HEADER.map(h => cell(String(r[h] ?? ''))).join(',')).join('\n') + '\n');
}

// Adds a row unless the invoice # is already there. Returns 'appended' | 'exists'.
function append(client, row) {
  const rows = read(client);
  if (rows.some(r => r.invoice === row.invoice)) return 'exists';
  rows.push(row); write(client, rows); return 'appended';
}

function markPaidThrough(client, date) {
  const rows = read(client);
  const hit = rows.filter(r => r.date <= date && !r.status.startsWith('paid'));
  hit.forEach(r => { r.status = 'paid'; r.paid_on = ''; });
  write(client, rows); return hit.length;
}

function markPaid(client, invoice, paidOn) {
  const rows = read(client);
  const r = rows.find(x => x.invoice.toLowerCase() === invoice.toLowerCase());
  if (!r) throw new Error(`no ledger row for "${invoice}"`);
  r.status = 'paid'; r.paid_on = paidOn || new Date().toLocaleDateString('en-CA');
  write(client, rows); return r;
}

// ---------- the page ----------
const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const niceDate = iso => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return esc(iso); const d = new Date(iso + 'T00:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };

function render(client) {
  const rows = read(client);
  const year = new Date().getFullYear();
  const num = r => parseFloat(r.amount) || 0;
  const isPaid = r => r.status.startsWith('paid');
  const open = rows.filter(r => !isPaid(r) && num(r) > 0);
  const openTotal = open.reduce((s, r) => s + num(r), 0);
  const billedYtd = rows.filter(r => r.date.startsWith(String(year))).reduce((s, r) => s + num(r), 0);
  const paidYtd = rows.filter(r => isPaid(r) && (r.paid_on || '').startsWith(String(year))).reduce((s, r) => s + num(r), 0);
  const oldest = open.length ? open[0] : null;
  const unread = rows.filter(r => !r.amount).length;

  const byYear = {};
  rows.forEach(r => { const y = r.date.slice(0, 4) || '—'; (byYear[y] = byYear[y] || []).push(r); });
  const years = Object.keys(byYear).sort().reverse();

  const tr = r => {
    const paid = isPaid(r);
    const status = paid ? `<span class="pill paid">paid${r.paid_on ? ' ' + niceDate(r.paid_on) : ''}</span>` : r.amount ? `<span class="pill open">open</span>` : `<span class="pill blank">amount not read</span>`;
    const cmd = paid ? '' : ` title='mark paid: node ledger.js paid "${esc(r.invoice)}"'`;
    return `<tr class="${paid ? 'is-paid' : 'is-open'}"${cmd}>
      <td class="d">${niceDate(r.date)}</td>
      <td class="i">${r.pdf ? `<a href="${esc(encodeURI(r.pdf))}">${esc(r.invoice)}</a>` : esc(r.invoice)}</td>
      <td class="n">${r.hours ? esc(r.hours) : '<span class="faint">—</span>'}</td>
      <td class="n amt">${r.amount ? '$' + money(r.amount) : '<span class="faint">—</span>'}</td>
      <td class="s">${status}</td>
    </tr>`;
  };
  const yearBlock = y => {
    const rs = byYear[y].slice().sort((a, b) => (b.date + b.invoice).localeCompare(a.date + a.invoice));
    const billed = rs.reduce((s, r) => s + num(r), 0);
    return `<section>
      <h2>${esc(y)} <span class="sum">$${money(billed)} billed · ${rs.length} invoice${rs.length === 1 ? '' : 's'}</span></h2>
      <table><thead><tr><th>Date</th><th>Invoice</th><th class="n">Hours</th><th class="n">Amount</th><th>Status</th></tr></thead>
      <tbody>${rs.map(tr).join('')}</tbody></table>
    </section>`;
  };

  const html = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(client.invoice_prefix)} Invoice Ledger</title>
<style>
  :root { color-scheme: light dark; --ink:#0f172a; --muted:#64748b; --faint:#94a3b8; --rule:#e2e8f0; --card:#fff; --bg:#f8fafc; --accent:#0ea5e9; --tint:#f0f9ff; --amber:#b45309; --amber-bg:#fef3c7; --paid:#0369a1; --paid-bg:#e0f2fe; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e2e8f0; --muted:#94a3b8; --faint:#64748b; --rule:#334155; --card:#1e293b; --bg:#0f172a; --tint:#172033; --amber:#fbbf24; --amber-bg:#3b2f0b; --paid:#7dd3fc; --paid-bg:#0c2a3f; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 24px 64px; background:var(--bg); color:var(--ink); font:13px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  header { display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom: 20px; }
  h1 { margin:0; font-size:20px; font-weight:700; letter-spacing:-.01em; }
  h1 span { color: var(--accent); }
  .stamp { color: var(--faint); font-size: 12px; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom: 28px; }
  .stat { background: var(--card); border: 1px solid var(--rule); border-radius: 10px; padding: 12px 14px; }
  .stat .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  .stat .v { font-size: 22px; font-weight: 700; margin-top: 2px; letter-spacing: -.01em; }
  .stat .v.open { color: var(--amber); }
  .stat .sub { color: var(--faint); font-size: 11.5px; margin-top: 2px; }
  section { margin-bottom: 28px; }
  h2 { font-size: 15px; margin: 0 0 8px; display:flex; align-items:baseline; gap:10px; }
  h2 .sum { color: var(--muted); font-weight: 400; font-size: 12px; }
  table { width:100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--rule); border-radius: 10px; overflow: hidden; }
  th { text-align:left; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; padding: 9px 12px; border-bottom: 1px solid var(--rule); }
  td { padding: 9px 12px; border-bottom: 1px solid var(--rule); vertical-align: baseline; }
  tr:last-child td { border-bottom: none; }
  tr.is-open:hover { background: var(--tint); }
  td.d { color: var(--muted); white-space: nowrap; width: 110px; }
  td.i a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
  td.i a:hover { color: var(--accent); border-color: var(--accent); }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.amt { font-weight: 600; }
  tr.is-paid td.amt { font-weight: 400; color: var(--muted); }
  .faint { color: var(--faint); }
  .pill { display:inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .pill.open { background: var(--amber-bg); color: var(--amber); }
  .pill.paid { background: var(--paid-bg); color: var(--paid); }
  .pill.blank { background: var(--rule); color: var(--muted); }
  footer { color: var(--faint); font-size: 12px; margin-top: 12px; }
  footer code { font: 11.5px ui-monospace, Menlo, monospace; background: var(--card); border: 1px solid var(--rule); border-radius: 4px; padding: 1px 5px; }
</style>
<main>
  <header>
    <h1>${esc(client.invoice_prefix)} <span>Invoice Ledger</span></h1>
    <div class="stamp">${esc(client.client)} · updated ${niceDate(new Date().toLocaleDateString('en-CA'))}</div>
  </header>
  <div class="stats">
    <div class="stat"><div class="k">Open receivables</div><div class="v open">$${money(openTotal)}</div><div class="sub">${open.length} open${oldest ? ` · oldest ${niceDate(oldest.date)}` : ''}</div></div>
    <div class="stat"><div class="k">Billed ${year}</div><div class="v">$${money(billedYtd)}</div><div class="sub">${rows.filter(r => r.date.startsWith(String(year))).length} invoices</div></div>
    <div class="stat"><div class="k">Paid ${year}</div><div class="v">$${money(paidYtd)}</div><div class="sub">by paid-on date</div></div>
  </div>
  ${years.map(yearBlock).join('')}
  <footer>The record is <code>ledger.csv</code> beside this page. Mark an invoice paid with <code>node scripts/tom/ledger.js paid "RMH Sept 2026" 2026-09-20</code> — or tell Tom.${unread ? ` ${unread} row${unread === 1 ? '' : 's'} came from a Pages file with no PDF, so the amount wasn't read.` : ''}</footer>
</main>
`;
  fs.writeFileSync(htmlPath(client), html);
  return htmlPath(client);
}

module.exports = { read, append, markPaid, markPaidThrough, render, csvPath, htmlPath, loadClient };

if (require.main === module) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--client');
  const client = loadClient(ci >= 0 ? args[ci + 1] : 'rmh');
  const cmd = args.filter((a, i) => !(a === '--client' || (ci >= 0 && i === ci + 1)));
  if (cmd[0] === 'paid') {
    if (!cmd[1]) { console.error('usage: node ledger.js paid "RMH Sept 2026" [YYYY-MM-DD]'); process.exit(2); }
    const r = markPaid(client, cmd[1], cmd[2]);
    console.log(`${r.invoice}: paid ${r.paid_on}`);
  } else if (cmd[0] === 'paid-through') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cmd[1] || '')) { console.error('usage: node ledger.js paid-through YYYY-MM-DD'); process.exit(2); }
    console.log(`${markPaidThrough(client, cmd[1])} invoice(s) marked paid`);
  }
  const out = render(client);
  console.log('→ ' + out);
  if (cmd[0] === 'open') require('child_process').spawn('open', ['-a', 'Safari', out], { stdio: 'ignore', detached: true }).unref();
}
