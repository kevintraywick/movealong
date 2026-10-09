// Reads the bank and card statements Kevin drops on the finance pane (2026-10-09).
// Four CSV shapes, told apart by their header and their signs:
//   Apple Card   Transaction Date, Clearing Date, Description, Merchant, Category, Type, Amount (USD), ...
//                (a purchase is positive)
//   Bank of America  Posted Date, Reference Number, Payee, Address, Amount   (a purchase is negative)
//   BECU         Date, No., Description, Debit, Credit
//                checking: withdrawals are negative numbers in Debit; the card: charges are positive in Debit
// Every row comes out as { acct, date, desc, amount } where amount is the effect on that account's balance
// (money out negative). Exports overlap, so a row seen in two files counts once (the larger count of
// identical rows in any one file wins, so two real identical charges in one file both stay).

const fs = require('fs');
const path = require('path');

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(x => x !== '')) rows.push(row); }
  return rows;
}
const toDay = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const num = (s) => { const n = parseFloat(String(s == null ? '' : s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };

function parseFile(text) {
  const t = parseCsv(text.replace(/^﻿/, ''));
  if (t.length < 2) return [];
  const head = t[0].map(h => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const out = [];
  if (head.includes('transaction date') && head.includes('amount (usd)')) {
    for (const r of t.slice(1)) {
      const date = toDay(r[col('transaction date')]), amt = num(r[col('amount (usd)')]);
      if (!date || amt === null) continue;
      out.push({ acct: 'apple', date, desc: (r[col('merchant')] || r[col('description')] || '').trim(), amount: -amt });
    }
  } else if (head.includes('posted date') && head.includes('payee')) {
    for (const r of t.slice(1)) {
      const date = toDay(r[col('posted date')]), amt = num(r[col('amount')]);
      if (!date || amt === null) continue;
      out.push({ acct: 'bofa', date, desc: (r[col('payee')] || '').trim(), amount: amt });
    }
  } else if (head.includes('debit') && head.includes('credit') && head.includes('description')) {
    const rows = t.slice(1).map(r => ({ date: toDay(r[col('date')]), desc: (r[col('description')] || '').trim(), debit: num(r[col('debit')]), credit: num(r[col('credit')]) })).filter(r => r.date);
    // Checking shows withdrawals as negative Debit; the card shows charges as positive Debit.
    const checking = rows.some(r => r.debit !== null && r.debit < 0) || rows.some(r => /deposit|pos withdrawal|external withdrawal/i.test(r.desc));
    for (const r of rows) {
      if (checking) out.push({ acct: 'becu_checking', date: r.date, desc: r.desc, amount: (r.debit || 0) + (r.credit || 0) });
      else out.push({ acct: 'becu_visa', date: r.date, desc: r.desc, amount: -(r.debit || 0) - (r.credit || 0) });
    }
  }
  return out;
}

// Combine files: identical rows across files collapse to the largest count seen in any one file.
function combine(files) {
  const perFile = files.map(f => { const m = new Map(); for (const r of f) { const k = `${r.acct}|${r.date}|${r.desc}|${r.amount.toFixed(2)}`; const e = m.get(k) || { r, n: 0 }; e.n++; m.set(k, e); } return m; });
  const best = new Map();
  for (const m of perFile) for (const [k, e] of m) { const b = best.get(k); if (!b || e.n > b.n) best.set(k, e); }
  const out = [];
  for (const e of best.values()) for (let i = 0; i < e.n; i++) out.push(e.r);
  return out;
}
function loadRows(dir, statementRows) {
  const files = [];
  for (const s of statementRows) {
    try { files.push(parseFile(fs.readFileSync(path.join(dir, path.basename(s.file)), 'utf8'))); } catch (e) { /* a file that is gone or unreadable is skipped */ }
  }
  return combine(files);
}

// What a checking-account line is, for the cash chart.
//   income   a deposit that is not a move between his own accounts
//   transfer to or from his other accounts (savings, the share account, overdraft cover)
//   plan     a payment on a card or a payment plan
//   bill     a recurring bill
//   other    taxes, checks and the like
//   daily    everything else he spends (card swipes, Cash App, Zelle)
const RE = {
  transfer: /online banking transfer|overdraft protection|^withdrawal - transfer to|dividend|interest/i,
  plan: /applecard|apple card|gsbank|bank of america|bofa|visa autopay|transfer to\s+visa|credit card|capital one|chase|discover|baptist/i,
  bill: /tmobile|t-mobile|bcbs|blue cross|urban storage|west ky|dynamix|anthropic|google|apple services|visible|midjourney|elevenlabs|github|insurance|\brent\b|utility|electric|water|internet|storage/i,
  other: /\birs\b|treasury|usataxpymt|\btax\b|^check\b|electronic check/i
};
function label(desc) {
  return desc.replace(/^(external withdrawal|pos withdrawal|transfer withdrawal|withdrawal|deposit|transfer deposit|electronic check)\s*-\s*/i, '')
    .replace(/\s*card ending in \d+/i, '').replace(/\s+\d{3,}.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 34) || desc.slice(0, 34);
}
function classify(r) {
  const d = r.desc;
  if (r.amount > 0) {
    if (RE.transfer.test(d)) return 'transfer';
    if (/mobile banking|deposit - (check|ach|direct)|payroll|direct dep/i.test(d) || r.amount >= 100) return 'income';
    return 'other';
  }
  if (/transfer\s+to\s+visa|visa autopay/i.test(d)) return 'plan';   // paying his BECU card
  if (RE.transfer.test(d)) return 'transfer';
  if (RE.other.test(d)) return 'other';
  if (RE.plan.test(d)) return 'plan';
  if (RE.bill.test(d)) return 'bill';
  return 'daily';
}

// Daily flows of the checking account over a window, by kind, with the line items for hover.
function history(rows, from, to) {
  const days = {};
  let any = false;
  for (const r of rows) {
    if (r.acct !== 'becu_checking' || r.date < from || r.date > to) continue;
    any = true;
    const d = days[r.date] = days[r.date] || { income: 0, bill: 0, plan: 0, daily: 0, other: 0, transferIn: 0, transferOut: 0, net: 0, items: [] };
    let k = classify(r);
    if (k === 'transfer') k = r.amount > 0 ? 'transferIn' : 'transferOut';
    d[k] += Math.abs(r.amount); d.net += r.amount;
    d.items.push([k, label(r.desc), Math.round(Math.abs(r.amount) * 100) / 100]);
  }
  for (const d of Object.values(days)) for (const k of ['income', 'bill', 'plan', 'daily', 'other', 'transferIn', 'transferOut', 'net']) d[k] = Math.round(d[k] * 100) / 100;
  const dates = rows.filter(r => r.acct === 'becu_checking').map(r => r.date).sort();
  return { from, to, has_checking: any || dates.length > 0, coverage: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null, days };
}

module.exports = { parseFile, combine, loadRows, classify, history };
