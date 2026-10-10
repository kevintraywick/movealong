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
      out.push({ acct: 'apple', date, desc: (r[col('merchant')] || r[col('description')] || '').trim(), amount: -amt, appleCategory: (r[col('category')] || '').trim() });
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

// ---- Categories (2026-10-09) ----
// Spending is counted when it happens, on whichever account it happens: a card purchase is groceries when you
// buy them, not when the card is paid. Payments between his own accounts and card payments are not spending.
const CAT_RE = {
  medical: /bcbs|blue cross|baptist|anesth|pharm|\bcvs\b|walgreens|dental|dentist|clinic|hospital|medical|physical therap|urgent care|doctor|eyeworks|optic|\bmed\*|\bpt \*/i,
  groceries: /market|foods?\b|convenience|quick stop|bottle|casey|grocer|food store|a to z food|wal-?mart|wm supercenter|walmart|dollar general|trader joe|\bpcc\b|kroger|aldi|safeway|food lion|7-eleven|pepsi|publix|costco|murphyatwal/i,
  dining: /restaurant|cafe|coffee|pizza|grill|tavern|taproom|sushi|steakhouse|mcdonald|arby|chick-fil|sonic|drive in|billiards|vantage|ruler foods|doordash|uber eats|bar\b|brew|donut|bakery|kitchen|diner|woodfire/i,
  travel: /airline|\bair\b|alaska air|american air|broadway\.com|hotel|airbnb|shell oil|exxon|chevron|\bgas\b|fuel|parking|sdot|paybyphone|\buber\b|\blyft\b|mnaa|rental car|amtrak/i,
  taxes: /\birs\b|treasury|usataxpymt|\btax\b/i,
  shopping: /amazon|amzn|mktpl|lumber|\brei\b|home depot|lowe'?s|target|best buy|etsy|ebay|boutique|lingerie|camera|goodwill|fred.?meyer|styles on|unreal engine|epc\*/i,
  bills: /tmobile|t-mobile|visible|urban storage|west ky|dynamix|anthropic|claude|google|apple services|apple\.com|amazon prime|midjourney|elevenlabs|github|insurance|annual fee|netflix|spotify|hover|obsidian|storage|fiber|internet|utility|electric|water|gym/i
};
const APPLE_CAT = { restaurants: 'dining', groceries: 'groceries', transportation: 'travel', health: 'medical', 'medical': 'medical' };
// dad (2026-10-10): his father's care, frequent and irregular; which merchants are dad is learned per user
// (finance_categories), never a rule here.
const KNOWN_CATS = ['income', 'taxes', 'medical', 'bills', 'groceries', 'dining', 'travel', 'shopping', 'entertainment', 'dad', 'other'];
function category(r, appleCategory, overrides) {
  if (overrides && overrides.size) { const o = overrides.get(merchantKey(r.desc)); if (o) return o; }
  for (const k of ['taxes', 'medical', 'bills', 'groceries', 'dining', 'travel', 'shopping']) if (CAT_RE[k].test(r.desc)) return k;
  if (appleCategory && APPLE_CAT[appleCategory.toLowerCase()]) return APPLE_CAT[appleCategory.toLowerCase()];
  return 'other';
}
const merchantKey = (d) => d.toUpperCase().replace(/^\s*(EXTERNAL WITHDRAWAL|POS WITHDRAWAL|TRANSFER WITHDRAWAL|TRANSFER DEPOSIT|ELECTRONIC CHECK|WITHDRAWAL|DEPOSIT)\s*-\s*/, '').replace(/POS WITHDRAWAL - |EXTERNAL WITHDRAWAL - |PURCHASE AUTHORIZED ON.*/g, '').replace(/^\s*(SQ|TST|PT|MED|PY|PP|EPC|DD)\s?\*\s?/, '').replace(/CARD ENDING IN \d+/g, '').replace(/[#*]\S*/g, ' ').replace(/\d[\d\-/.]*/g, ' ').replace(/[^A-Z& ]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 3).join(' ');

// What a checking-account line is, for the cash line and the income bars.
const RE = {
  transfer: /online banking transfer|overdraft protection|^withdrawal - transfer to|dividend|interest/i,
  cardpay: /applecard|apple card|gsbank|bank of america|bofa|visa autopay|transfer\s+to\s+visa|credit card|capital one|chase|discover|payment - thank you|online\/mobile payment|payment received/i
};
function label(desc) {
  return desc.replace(/^(external withdrawal|pos withdrawal|transfer withdrawal|withdrawal|deposit|transfer deposit|electronic check)\s*-\s*/i, '')
    .replace(/\s*card ending in \d+/i, '').replace(/\s+\d{3,}.*$/, '').replace(/^TST\*\s*|^SQ \*\s*|^PT \*\s*|^MED\*\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 34) || desc.slice(0, 34);
}

// Daily money in and out over a window. income: checking deposits that are not moves between his own accounts.
// spend: purchases on every account, by category, with the recurring part marked (a merchant that charges in three
// or more different months, or a recurring kind of bill in two). net: the checking account's own movement, which
// is what the cash line follows. moves: card payments and transfers between his accounts that day (['card'|'in'|'out',
// label, amount]) so a dip in the cash line has a reason. shares: how his everyday spending splits by category over
// the last 90 days. months: income, spending by category and card payments for every month the files cover (habits).
// accounts: first and last date each account's files reach, so a stale statement can be named.
function history(rows, from, to, appleCats, overrides) {
  appleCats = appleCats || new Map(); overrides = overrides || new Map();
  const months = new Map();
  for (const r of rows) { if (r.amount < 0) { const k = merchantKey(r.desc); if (k) { if (!months.has(k)) months.set(k, new Set()); months.get(k).add(r.date.slice(0, 7)); } } }
  const recurring = (r) => { const k = merchantKey(r.desc), n = (months.get(k) || new Set()).size; return n >= 3 || (n >= 2 && CAT_RE.bills.test(r.desc)); };
  const days = {};
  const day = (d) => days[d] = days[d] || { income: 0, spend: {}, rec: {}, net: 0, items: [], moves: [] };
  const share = {}; let shareTotal = 0;
  const shareFrom = new Date(Date.parse(to + 'T00:00:00Z') - 90 * 86400000).toISOString().slice(0, 10);
  // Habits by month, every month the files cover: income, spending by category, what went to the cards.
  const byMonth = {};
  const month = (d) => byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || { income: 0, spend: 0, cats: {}, cardPay: 0 };
  const r2 = (n) => Math.round(n * 100) / 100;
  let any = false;
  for (const r of rows) {
    const inWindow = r.date >= from && r.date <= to;
    if (r.acct === 'becu_checking') {
      if (inWindow) { any = true; day(r.date).net += r.amount; }
      if (r.amount > 0) {
        if (!RE.transfer.test(r.desc) && (/mobile banking|deposit - (check|ach|direct)|payroll|direct dep/i.test(r.desc) || r.amount >= 100)) {
          month(r.date).income += r.amount;
          if (inWindow) { const d = day(r.date); d.income += r.amount; d.items.push(['income', label(r.desc), r2(r.amount), false]); }
        } else if (inWindow) day(r.date).moves.push(['in', label(r.desc), r2(r.amount)]);
        continue;
      }
      // Money leaving checking for his own cards or accounts is a move, not spending: the cash line dips, no bar.
      if (RE.cardpay.test(r.desc)) { month(r.date).cardPay += -r.amount; if (inWindow) day(r.date).moves.push(['card', label(r.desc), r2(-r.amount)]); continue; }
      if (RE.transfer.test(r.desc)) { if (inWindow) day(r.date).moves.push(['out', label(r.desc), r2(-r.amount)]); continue; }
    } else if (r.amount > 0) continue;   // a card payment or refund is not spending
    if (r.amount >= 0) continue;
    if (RE.transfer.test(r.desc) || RE.cardpay.test(r.desc)) continue;   // moves between his accounts, card payments
    const cat = category(r, appleCats.get(r.date + '|' + r.desc + '|' + r.amount.toFixed(2)), overrides);
    const rec = recurring(r), amt = -r.amount;
    const mo = month(r.date); mo.spend += amt; mo.cats[cat] = (mo.cats[cat] || 0) + amt;
    if (inWindow) { const d = day(r.date); d.spend[cat] = (d.spend[cat] || 0) + amt; if (rec) d.rec[cat] = (d.rec[cat] || 0) + amt; d.items.push([cat, label(r.desc), r2(amt), rec, merchantKey(r.desc)]); }
    if (r.date >= shareFrom && r.date <= to && !rec && amt < 250) { share[cat] = (share[cat] || 0) + amt; shareTotal += amt; }
  }
  for (const d of Object.values(days)) { d.net = r2(d.net); d.income = r2(d.income); for (const m of [d.spend, d.rec]) for (const k of Object.keys(m)) m[k] = r2(m[k]); }
  for (const m of Object.values(byMonth)) { m.income = r2(m.income); m.spend = r2(m.spend); m.cardPay = r2(m.cardPay); for (const k of Object.keys(m.cats)) m.cats[k] = r2(m.cats[k]); }
  const shares = {}; if (shareTotal > 0) for (const k of Object.keys(share)) shares[k] = Math.round(share[k] / shareTotal * 1000) / 1000;
  // What each account's files cover, so the pane can say which statement has gone stale.
  const accounts = {};
  for (const r of rows) { const a = accounts[r.acct] = accounts[r.acct] || { first: r.date, last: r.date, rows: 0 }; a.rows++; if (r.date < a.first) a.first = r.date; if (r.date > a.last) a.last = r.date; }
  const ck = accounts.becu_checking;
  return { from, to, has_checking: any || !!ck, coverage: ck ? { first: ck.first, last: ck.last } : null, accounts, days, shares, months: byMonth };
}

module.exports = { parseFile, combine, loadRows, history, merchantKey, KNOWN_CATS };
