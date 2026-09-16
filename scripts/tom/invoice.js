#!/usr/bin/env node
// Tom's invoice skill — renders a monthly consulting invoice as a PDF and
// records it in the receivables ledger. Pure Node + pdfkit: no Pages, no
// browser, no service. Kevin's old invoice was a Pages document duplicated
// from last month's and edited by hand (2026-09-16).
//
//   node invoice.js --client rmh --month 2026-10 --hours 27.7 [--expenses 0]
//                   [--out path.pdf] [--no-ledger] [--force] [--json]
//
// Pattern (read off the 2025–2026 RMH invoices): dated the 1st of the month,
// a fixed retainer, "Additional <previous month> hours" at the hourly rate,
// expenses, total. Invoice # and filename are "RMH Oct 2026".

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const flag = name => args.includes('--' + name);

const clientKey = opt('client', 'rmh');
const monthArg = opt('month');
const hours = parseFloat(opt('hours', '0')) || 0;
const expenses = parseFloat(opt('expenses', '0')) || 0;
if (!monthArg || !/^\d{4}-\d{2}$/.test(monthArg)) {
  console.error('usage: node invoice.js --client rmh --month YYYY-MM --hours N [--expenses N] [--out file] [--no-ledger] [--force] [--json]');
  process.exit(2);
}

const client = JSON.parse(fs.readFileSync(path.join(__dirname, 'clients', clientKey + '.json'), 'utf8'));

// The month names Kevin actually used on the files: Jan Feb Mar Apr May June July Aug Sept Oct Nov Dec.
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const [year, month] = monthArg.split('-').map(Number);
const prev = month === 1 ? 12 : month - 1;
const invoiceNo = `${client.invoice_prefix} ${SHORT[month - 1]} ${year}`;
const dateLine = `${SHORT[month - 1]} 1, ${year}`;
const isoDate = `${year}-${String(month).padStart(2, '0')}-01`;
const hoursLabel = `Additional ${LONG[prev - 1]} hours`;

const round2 = n => Math.round(n * 100) / 100;
const hoursAmount = round2(hours * client.rate);
const total = round2(client.retainer + hoursAmount + expenses);
const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const yearDir = path.join(client.invoices_dir, String(year));
const outPath = opt('out') || path.join(yearDir, `${invoiceNo} Invoice.pdf`);
if (fs.existsSync(outPath) && !flag('force')) {
  console.error(`refusing to overwrite ${outPath} (pass --force)`);
  process.exit(3);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });

// ---------- render ----------
const INK = '#0f172a', MUTED = '#64748b', FAINT = '#94a3b8', RULE = '#e2e8f0', ACCENT = '#0ea5e9';
const doc = new PDFDocument({ size: 'LETTER', margins: { top: 64, bottom: 64, left: 60, right: 60 }, info: { Title: `${invoiceNo} Invoice`, Author: client.from.name } });
doc.pipe(fs.createWriteStream(outPath));
const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;

// accent bar across the top — the one colour on the page
doc.rect(0, 0, doc.page.width, 6).fill(ACCENT);

// header: name left, INVOICE right
let y = 64;
doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(client.from.name, L, y);
doc.font('Helvetica').fontSize(22).fillColor(MUTED).text('Invoice', L, y, { width: W, align: 'right' });
y += 34;
doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
const fromLines = [client.from.phone, client.from.email, ...client.from.address];
fromLines.forEach((line, i) => doc.text(line, L, y + i * 13));

// meta, right-aligned, label · value
const meta = [['Invoice #', invoiceNo], ['Date', dateLine]];
meta.forEach(([k, v], i) => {
  const yy = y + i * 15;
  doc.font('Helvetica').fontSize(9.5).fillColor(FAINT).text(k, L, yy, { width: W - 130, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(v, R - 120, yy - 1, { width: 120, align: 'right' });
});
y += fromLines.length * 13 + 30;

// bill to
doc.font('Helvetica').fontSize(8.5).fillColor(FAINT).text('BILL TO', L, y, { characterSpacing: 1 });
y += 14;
doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(client.contact, L, y);
y += 15;
doc.font('Helvetica').fontSize(11).fillColor(INK).text(client.client, L, y);
y += 40;

// table
const cols = { desc: L, hours: R - 260, rate: R - 170, amount: R - 90 };
const colW = { hours: 70, rate: 80, amount: 90 };
const header = () => {
  doc.font('Helvetica').fontSize(8.5).fillColor(FAINT);
  doc.text('DESCRIPTION', cols.desc, y, { characterSpacing: 1 });
  doc.text('HOURS', cols.hours, y, { width: colW.hours, align: 'right', characterSpacing: 1 });
  doc.text('RATE', cols.rate, y, { width: colW.rate, align: 'right', characterSpacing: 1 });
  doc.text('AMOUNT', cols.amount, y, { width: colW.amount, align: 'right', characterSpacing: 1 });
  y += 16;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(INK).stroke();
  y += 12;
};
const row = (desc, hrs, rate, amount) => {
  doc.font('Helvetica').fontSize(11).fillColor(INK).text(desc, cols.desc, y);
  doc.fillColor(hrs === null ? FAINT : INK).text(hrs === null ? '—' : String(hrs), cols.hours, y, { width: colW.hours, align: 'right' });
  doc.fillColor(rate === null ? FAINT : INK).text(rate === null ? '—' : money(rate), cols.rate, y, { width: colW.rate, align: 'right' });
  doc.fillColor(INK).text(money(amount), cols.amount, y, { width: colW.amount, align: 'right' });
  y += 20;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(RULE).stroke();
  y += 12;
};
header();
row('Retainer', null, null, client.retainer);
row(hoursLabel, hours, client.rate, hoursAmount);
row('Expenses', null, null, expenses);

// total
y += 4;
doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Total', cols.rate - 60, y + 3, { width: 140, align: 'right' });
doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('$' + money(total), cols.amount - 40, y, { width: colW.amount + 40, align: 'right' });
y += 34;
doc.moveTo(cols.rate - 60, y).lineTo(R, y).lineWidth(1).strokeColor(INK).stroke();

// closing
y += 48;
doc.font('Helvetica').fontSize(11).fillColor(INK);
client.closing.forEach((line, i) => doc.text(line, L, y + i * 22));

doc.end();

// ---------- ledger (accounts receivable) ----------
// ledger.csv beside the invoices is the record; ledger.html beside it is the
// view Kevin opens in Safari. See ledger.js.
const ledgerRow = { date: isoDate, invoice: invoiceNo, client: client.key, hours: String(hours), amount: total.toFixed(2), status: 'open', paid_on: '', pdf: `${year}/${path.basename(outPath)}` };
let ledger = 'skipped', ledgerPage = null;
if (!flag('no-ledger')) {
  const L = require('./ledger');
  ledger = L.append(client, ledgerRow);
  ledgerPage = L.render(client);
}

const result = { pdf: outPath, invoice: invoiceNo, date: dateLine, hours, rate: client.rate, retainer: client.retainer, expenses, total, ledger, ledger_page: ledgerPage, ledger_row: ledgerRow };
if (flag('json')) console.log(JSON.stringify(result, null, 2));
else console.log(`${invoiceNo}: ${hours} h × $${client.rate} + $${client.retainer} retainer + $${expenses} expenses = $${money(total)}\n→ ${outPath}\n→ ledger ${ledger}${ledgerPage ? ' · ' + ledgerPage : ''}`);
