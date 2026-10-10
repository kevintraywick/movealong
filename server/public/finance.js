// The finance pane on the dashboard (2026-10-09, reworked 2026-10-10): four
// balances a day, a projection of cash, debt and savings (15 days back and
// ahead as bars with the cash line; a spending-only chart of the same days;
// 30 back and ahead as the cash line), one tip-or-alert row that Tom
// writes, a row of what the pane needs from Kevin, the goals ladder, and a
// drop zone for statements. The page projects; the server
// stores (routes in server.js, tables in db.js). It lives in a shadow root so
// the dashboard's own styles (.stat, .legend, .entry ...) can't leak in or out.
// Design source: finance-dashboard-mockup.html at the repo root.
(function () {
    'use strict';
    const host = document.getElementById('financePane');
    if (!host) return;
    let sess = null;
    try { sess = JSON.parse(localStorage.getItem('movealong.session') || 'null'); } catch (e) { /* signed out */ }
    if (!sess || !sess.subdomain || !sess.slug) return;
    const base = `/api/companies/${encodeURIComponent(sess.subdomain)}/users/${encodeURIComponent(sess.slug)}/finance`;
    const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'UTC'; } };
    async function call(path, opts) {
        opts = opts || {};
        const res = await fetch(path.startsWith('/api') ? path : base + path, {
            method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', 'x-tz': zone() },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || ('HTTP ' + res.status));
        return out;
    }

    const root = host.attachShadow({ mode: 'open' });
    const CSS = `:host { display: block; }
#fin { --orange: #eb6834; --blue: #0284c7; --violet: #4a3aa7; --pink: #c2417a; --debtc: #b91c1c; --red: #ef4444; --ink: #0f172a; --plan: #64748b; --band: rgba(100,116,139,.16); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #0f172a; }
#fin.dark { --orange: #ea580c; --violet: #9085e9; --pink: #f472b6; --debtc: #fca5a5; --red: #f87171; --ink: #f1f5f9; --plan: #94a3b8; --band: rgba(255,255,255,.12); color: #e2e8f0; }
*, *::before, *::after { box-sizing: border-box; }
#fin.dark { --orange: #ea580c; --blue: #0284c7; --violet: #9085e9; --red: #f87171; }
.btn {
        font: inherit; font-size: 12px; padding: 4px 11px; border-radius: 6px; cursor: pointer;
        border: 1px solid #e2e8f0; background: #fff; color: #0284c7;
    }
.btn:hover { border-color: #bae6fd; background: #f0f9ff; }
.btn.quiet { color: #64748b; }
.btn.primary { background: #0ea5e9; border-color: #0ea5e9; color: #fff; }
.btn.primary:hover { background: #0284c7; }
#fin { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px 12px; min-width: 0; }
.pane-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.pane-title { font-size: 15px; font-weight: 600; }
.pane-head .l { min-width: 0; }
.sub { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin: 14px 0 6px; display: flex; align-items: baseline; gap: 8px; }
.sub .r { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; color: #64748b; }
.drop {
        flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center; font-size: 26px; line-height: 1; font-weight: 300;
        border: 1.5px dashed #7dd3fc; background: #f0f9ff; color: #0284c7; transition: background 0.15s, border-color 0.15s;
    }
.drop:hover { background: #e0f2fe; }
.drop.over { background: #e0f2fe; border-color: #0ea5e9; border-style: solid; }
.drop.has { border-style: solid; font-size: 12px; font-weight: 600; }
.files:empty { display: none; }
.files { font-size: 11px; color: #64748b; margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 4px 10px; justify-content: flex-end; }
.files span { white-space: nowrap; }
.files .fsum { cursor: pointer; color: #0284c7; }
.files a { color: #94a3b8; cursor: pointer; text-decoration: none; margin-left: 3px; }
.entry { display: flex; align-items: flex-end; gap: 8px; flex-wrap: nowrap; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.entry .day-nav { display: flex; align-items: center; gap: 3px; padding-bottom: 8px; }
.entry .day-nav button { width: 22px; height: 22px; border-radius: 50%; border: 1px solid #e2e8f0; background: #fff; color: #0284c7; cursor: pointer; font-size: 12px; line-height: 1; }
.entry .day-nav button:disabled { color: #cbd5e1; cursor: default; }
.entry .day-word { font-size: 12px; color: #334155; min-width: 44px; text-align: center; }
.entry .day-word b { color: #0284c7; font-weight: 600; }
.entry label { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.entry label .k { font-size: 10.5px; color: #64748b; }
.entry .money { position: relative; display: block; }
.entry .money i { position: absolute; left: 7px; top: 50%; transform: translateY(-50%); font-style: normal; font-size: 12px; color: #94a3b8; pointer-events: none; }
.entry input[type=text] { width: 100%; min-width: 0; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 6px 4px 16px; background: #fff; color: #0f172a; font-variant-numeric: tabular-nums; }
.entry input[type=text]:focus { outline: none; border-color: #7dd3fc; box-shadow: 0 0 0 2px #e0f2fe; }
.entry .state { font-size: 11px; color: #94a3b8; width: 34px; text-align: right; padding-bottom: 12px; flex-shrink: 0; }
.entry .state.saved { color: #0ea5e9; }
.boxes { display: grid; grid-template-columns: repeat(30, 1fr); gap: 3px; }
.boxes .b { aspect-ratio: 1; border-radius: 3px; border: 1px solid #bae6fd; background: #bae6fd; cursor: pointer; }
.boxes .b.on { background: #38bdf8; border-color: #38bdf8; }
.boxes .b.today { box-shadow: 0 0 0 2px #0284c7 inset; }
.boxes .b.sel { outline: 2px solid #0ea5e9; outline-offset: 1px; }
.tiprow { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 8px 10px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; font-size: 12.5px; line-height: 1.45; min-height: 42px; }
.tiprow.alert { border-color: #fecaca; background: #fef2f2; }
.tiprow .chip { flex-shrink: 0; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; border-radius: 4px; padding: 1px 6px; color: #0284c7; background: #e0f2fe; }
.tiprow.alert .chip { color: #fff; background: var(--red); }
.tiprow .txt { flex: 1; min-width: 0; }
.tiprow b { font-weight: 600; }
.tiprow .fb { display: flex; gap: 4px; flex-shrink: 0; }
.tiprow .fb button { font: inherit; font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fff; color: #64748b; cursor: pointer; }
.tiprow .fb button:hover { border-color: #bae6fd; color: #0284c7; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 10px; margin-top: 12px; }
.stat { border: 1px solid #f1f5f9; border-radius: 10px; padding: 8px 10px; }
.stat .k { font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 6px; }
.stat .k .sw { width: 8px; height: 8px; border-radius: 2px; }
.stat .v { font-size: 17px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.bar { height: 4px; border-radius: 2px; background: #f1f5f9; margin-top: 6px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #38bdf8; }
.chart-wrap { display: flex; align-items: stretch; gap: 10px; }
.chart-svg { flex: 1; min-width: 0; }
svg.chart { width: 100%; height: auto; display: block; }
svg.chart text { font-size: 10px; fill: #94a3b8; font-family: inherit; }
svg.chart text.today { fill: #0284c7; font-weight: 600; }
svg.chart .grid { stroke: #f1f5f9; stroke-width: 1; }
svg.chart .zero { stroke: #cbd5e1; stroke-width: 1; }
svg.chart .hit { fill: transparent; }
.tipbox { flex: 0 0 172px; width: 172px; border: 1px solid #f1f5f9; border-radius: 8px; padding: 7px 9px; font-size: 11px; line-height: 1.45; color: #334155; background: #f8fafc; overflow: hidden; }
.tipbox:empty { visibility: hidden; }
.tipbox .d { color: #64748b; margin-bottom: 3px; font-weight: 600; }
.tipbox > div { display: flex; align-items: baseline; gap: 4px; }
.tipbox > div > b { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tipbox > div > span:not(.sw) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tipbox i { color: #94a3b8; font-style: normal; font-size: 10px; }
#fin.dark .tipbox { background: #0f172a; border-color: #334155; color: #cbd5e1; }
#fin.dark .tipbox .d { color: #94a3b8; }
@media (max-width: 560px) { .chart-wrap { flex-wrap: wrap; } .tipbox { flex-basis: 100%; width: 100%; } }
.tipbox .sw { display: inline-block; flex-shrink: 0; width: 8px; height: 8px; border-radius: 2px; margin-right: 2px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #f1f5f9; font-size: 11.5px; color: #475569; }
.legend .item { display: flex; align-items: center; gap: 6px; }
.legend .sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.legend .sw.proj { background: transparent; border: 1.5px solid; }
.legend .ln { width: 14px; height: 0; border-top: 2px dashed var(--plan); }
.legend .sw.tick { width: 4px; height: 10px; border-radius: 1px; background: #94a3b8; margin: 0 3px; }
.legend label { display: flex; align-items: center; gap: 5px; cursor: pointer; margin-left: auto; }
.plans { display: flex; flex-direction: column; gap: 5px; }
.plan { display: grid; grid-template-columns: 18px 1fr 124px 86px auto 22px; gap: 6px; align-items: center; font-size: 12px; }
.plan.add { margin-top: 2px; }
.plan input[type=text], .plan input[type=date], .assume input { font: inherit; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px; background: #fff; color: #0f172a; min-width: 0; width: 100%; }
.plan input[type=checkbox] { accent-color: #0ea5e9; }
.plan .x { border: none; background: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
.plan label.every { font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.plan.off input[type=text], .plan.off input[type=date] { color: #94a3b8; }
.effect { font-size: 12px; color: #475569; margin-top: 6px; line-height: 1.5; }
.effect b { color: var(--violet); }
details { margin-top: 12px; }
summary { cursor: pointer; font-size: 12px; color: #64748b; }
.assume { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 12px; margin-top: 8px; }
.assume label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #64748b; }
.bills { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.bill { display: grid; grid-template-columns: 16px 1fr 52px 74px 118px auto 20px; gap: 6px; align-items: center; font-size: 12px; }
.bill input[type=text], .bill input[type=number], .bill input[type=date] { font: inherit; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px; background: #fff; color: #0f172a; min-width: 0; width: 100%; }
.bill .h { font-size: 10.5px; color: #94a3b8; }
.note { font-size: 11.5px; color: #64748b; line-height: 1.5; margin-top: 10px; }
.note b { color: #475569; }
#fin.dark { background: #0f172a; color: #e2e8f0; }
#fin.dark { background: #1e293b; border-color: #334155; }
#fin.dark .note, #fin.dark .effect, #fin.dark .files { color: #94a3b8; }
#fin.dark .note b { color: #cbd5e1; }
#fin.dark .btn { background: #1e293b; border-color: #334155; color: #38bdf8; }
#fin.dark .btn.primary { background: #0284c7; border-color: #0284c7; color: #fff; }
#fin.dark .btn.quiet { color: #94a3b8; }
#fin.dark .drop { background: rgba(14, 165, 233, 0.1); border-color: #0369a1; color: #38bdf8; }
#fin.dark .entry { background: #0f172a; border-color: #334155; }
#fin.dark .entry label .k { color: #94a3b8; }
#fin.dark .entry input[type=text], #fin.dark .plan input, #fin.dark .assume input, #fin.dark .bill input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
#fin.dark .entry .day-nav button { background: #1e293b; border-color: #334155; color: #38bdf8; }
#fin.dark .boxes .b { background: #0c4a6e; border-color: #0c4a6e; }
#fin.dark .boxes .b.on { background: #0284c7; border-color: #0284c7; }
#fin.dark .tiprow { background: #0f172a; border-color: #334155; }
#fin.dark .tiprow.alert { background: #2a1215; border-color: #7f1d1d; }
#fin.dark .tiprow .chip { background: rgba(14, 165, 233, 0.18); color: #38bdf8; }
#fin.dark .tiprow.alert .chip { background: var(--red); color: #1e293b; }
#fin.dark .tiprow .fb button { background: #1e293b; border-color: #334155; color: #94a3b8; }
#fin.dark .stat { border-color: #334155; }
#fin.dark .stat .v { color: #f1f5f9; }
#fin.dark .bar { background: #334155; }
#fin.dark svg.chart .grid { stroke: #334155; }
#fin.dark svg.chart .zero { stroke: #475569; }
#fin.dark svg.chart text.today { fill: #38bdf8; }
#fin.dark .legend { border-top-color: #334155; color: #cbd5e1; }
#fin.dark .sub { color: #64748b; }
#fin .empty { padding: 26px 0; text-align: center; color: #94a3b8; font-size: 12px; }
#fin .tiprow.idle .txt { color: #94a3b8; }
#fin .bill .x { border: none; background: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
#fin .bill label.debt { font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 3px; white-space: nowrap; }
#fin .bill.new input { border-style: dashed; }
#fin .inc { display: grid; grid-template-columns: 1fr 52px 74px 118px 20px; gap: 6px; align-items: center; font-size: 12px; margin-top: 4px; }
#fin .inc input[type=text], #fin .inc input[type=number], #fin .inc input[type=date] { font: inherit; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px; background: #fff; color: #0f172a; min-width: 0; width: 100%; }
#fin .inc.new input { border-style: dashed; }
#fin .inc .x { border: none; background: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
#fin .incomes { margin-top: 10px; }
#fin.dark .inc input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
#fin .cards { margin-top: 10px; }
#fin .card { display: grid; grid-template-columns: 1fr 64px 84px 84px 56px 110px 20px; gap: 6px; align-items: center; font-size: 12px; margin-top: 4px; }
#fin .card.h span { font-size: 10.5px; color: #94a3b8; }
#fin .card input[type=text], #fin .card input[type=number] { font: inherit; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px; background: #fff; color: #0f172a; min-width: 0; width: 100%; font-variant-numeric: tabular-nums; }
#fin .card.new input { border-style: dashed; }
#fin .card .use { font-size: 11px; color: #64748b; white-space: nowrap; }
#fin .card .x { border: none; background: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
#fin.dark .card input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
#fin.dark .card .use { color: #94a3b8; }
#fin .legend.one { flex-wrap: nowrap; overflow: hidden; white-space: nowrap; gap: 4px 10px; font-size: 10.5px; }
#fin .legend.one .item { flex-shrink: 0; gap: 4px; }
#fin .sw.hatch { background: repeating-linear-gradient(45deg, #64748b 0 2px, #fff 2px 4px); }
#fin.dark .sw.hatch { background: repeating-linear-gradient(45deg, #94a3b8 0 2px, #1e293b 2px 4px); }
#fin .ln.white { border-top: 2px solid #fff; box-shadow: 0 0 0 1px #64748b; }
#fin .bill.off input[type=text], #fin .bill.off input[type=number] { color: #94a3b8; text-decoration: line-through; }
#fin .monthend { margin-top: 8px; }
#fin .me-head { font-size: 12px; color: #475569; line-height: 1.5; }
#fin .me-head b { color: #0f172a; }
#fin .me-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 6px; }
#fin .me { border: 1px solid #f1f5f9; border-radius: 10px; padding: 7px 9px; font-size: 11.5px; }
#fin .me .k { font-size: 11px; font-weight: 600; color: #334155; margin-bottom: 3px; }
#fin .me .row { display: flex; justify-content: space-between; color: #64748b; font-variant-numeric: tabular-nums; }
#fin .me .row b { color: #0f172a; font-weight: 600; }
#fin .me .need { margin-top: 4px; font-weight: 600; font-size: 11.5px; }
#fin .me .need.short { color: var(--red); }
#fin .me .need.ok { color: #0284c7; }
#fin.dark .me-head, #fin.dark .me .k { color: #cbd5e1; }
#fin.dark .me-head b, #fin.dark .me .row b { color: #f1f5f9; }
#fin.dark .me { border-color: #334155; }
#fin.dark .me .need.ok { color: #38bdf8; }
#fin .goals { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
#fin .gtitle { font-size: 11px; font-weight: 600; color: #475569; }
#fin .gtitle span { font-weight: 400; color: #94a3b8; margin-left: 6px; }
#fin .goal { display: grid; grid-template-columns: 16px 1fr 20px; gap: 6px; align-items: center; }
#fin .goal input[type=text] { font: inherit; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px; background: #fff; color: #0f172a; min-width: 0; width: 100%; }
#fin .goal input[type=checkbox] { accent-color: #0ea5e9; }
#fin .goal.done input[type=text] { color: #94a3b8; text-decoration: line-through; }
#fin .goal .x { border: none; background: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
#fin.dark .gtitle { color: #cbd5e1; }
#fin.dark .goal input[type=text] { background: #0f172a; border-color: #334155; color: #e2e8f0; }
#fin .entry .state.err { color: #ef4444; width: auto; max-width: 110px; }
#fin .tiprow.needs { margin-top: 6px; border-style: dashed; background: #f8fafc; color: #475569; }
#fin .tiprow.needs .chip { color: #475569; background: #e2e8f0; }
#fin .ask { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#fin .ask .money { display: inline-block; width: 96px; }
#fin .ask .money i { position: absolute; left: 7px; top: 50%; transform: translateY(-50%); font-style: normal; font-size: 12px; color: #94a3b8; pointer-events: none; }
#fin .ask .money.pct i { left: auto; right: 7px; }
#fin .ask .money { position: relative; }
#fin .ask input[type=text] { width: 100%; font: inherit; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px 3px 16px; background: #fff; color: #0f172a; font-variant-numeric: tabular-nums; }
#fin .ask .money.pct input[type=text] { padding: 3px 18px 3px 6px; }
#fin .ask input.line { width: 260px; max-width: 100%; padding: 3px 6px; }
#fin .ask input[type=text]:focus { outline: none; border-color: #7dd3fc; box-shadow: 0 0 0 2px #e0f2fe; }
#fin .ask .fb { display: flex; gap: 4px; }
#fin .ask .fb button, #fin .catrow .fb button { font: inherit; font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; }
#fin .ask .fb button:hover, #fin .catrow .fb button:hover { border-color: #bae6fd; color: #0284c7; }
#fin .ask .who { font-size: 10px; font-weight: 700; letter-spacing: .05em; color: #0284c7; }
#fin.dark .ask input[type=text] { background: #0f172a; border-color: #334155; color: #e2e8f0; }
#fin.dark .ask .fb button, #fin.dark .catrow .fb button { background: #1e293b; border-color: #334155; color: #cbd5e1; }
#fin .tiprow.catrow { margin-top: 8px; border-style: dashed; background: #f8fafc; color: #475569; align-items: flex-start; }
#fin .tiprow.catrow .chip { color: #475569; background: #e2e8f0; margin-top: 2px; }
#fin .catrow .q + .q { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e2e8f0; }
#fin .catrow .opts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; align-items: center; }
#fin .catrow .opts label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
#fin .catrow .opts input[type=checkbox] { accent-color: #0ea5e9; margin: 0; }
#fin .catrow .opts input[type=text] { font: inherit; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 2px 6px; width: 120px; background: #fff; color: #0f172a; }
#fin.dark .tiprow.catrow { background: #0f172a; border-color: #334155; color: #cbd5e1; }
#fin.dark .tiprow.catrow .chip { color: #cbd5e1; background: #334155; }
#fin.dark .catrow .q + .q { border-top-color: #334155; }
#fin.dark .catrow .opts input[type=text] { background: #0f172a; border-color: #334155; color: #e2e8f0; }
#fin.dark .tiprow.needs { background: #0f172a; border-color: #334155; color: #cbd5e1; }
#fin.dark .tiprow.needs .chip { color: #cbd5e1; background: #334155; }
#fin .ladder { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
#fin .rung { display: grid; grid-template-columns: 20px 1fr; gap: 8px; align-items: start; }
#fin .rung .n { width: 20px; height: 20px; border-radius: 50%; border: 1px solid #e2e8f0; font-size: 11px; font-weight: 600; color: #64748b; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
#fin .rung.done .n { background: #16a34a; border-color: #16a34a; color: #fff; }
#fin .rung .t { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: #0f172a; }
#fin .rung .t .left { color: #64748b; font-variant-numeric: tabular-nums; white-space: nowrap; }
#fin .rung .track { position: relative; height: 6px; border-radius: 3px; background: #f1f5f9; margin: 5px 14px 0 0; }
#fin .rung .track i { display: block; height: 100%; border-radius: 3px; background: #38bdf8; }
#fin .rung.done .track i { background: #16a34a; }
#fin .rung .track em { position: absolute; top: -3px; width: 1px; height: 12px; background: #475569; }
#fin .rung .track b { position: absolute; right: -14px; top: -2px; width: 10px; height: 10px; border-radius: 50%; background: #16a34a; }
#fin .rung .lands { font-size: 11px; color: #64748b; margin-top: 3px; }
#fin .rung .lands.bad { color: var(--red); }
#fin.dark .rung .n { border-color: #334155; color: #94a3b8; }
#fin.dark .rung .t { color: #e2e8f0; }
#fin.dark .rung .track { background: #334155; }
#fin.dark .rung .track em { background: #cbd5e1; }
`;
    const MARKUP = `<div class="pane" id="fin">
            <div class="pane-head">
                <div class="pane-title">Finance</div>
            </div>
            <div class="entry" id="entry">
                <div class="day-nav"><button id="prev" title="Day before">‹</button><span class="day-word" id="dayWord"></span><button id="next" title="Day after">›</button></div>
                <label><span class="k">Cash</span><span class="money"><i>$</i><input type="text" inputmode="decimal" data-f="cash" autocomplete="off"></span></label>
                <label><span class="k">Savings</span><span class="money"><i>$</i><input type="text" inputmode="decimal" data-f="savings" autocomplete="off"></span></label>
                <label><span class="k">Debt</span><span class="money"><i>$</i><input type="text" inputmode="decimal" data-f="debt" autocomplete="off"></span></label>
                <label><span class="k">Trading</span><span class="money"><i>$</i><input type="text" inputmode="decimal" data-f="invest" autocomplete="off"></span></label>
                <span class="state" id="state"></span>
                <div class="drop" id="drop" role="button" aria-label="Add statements" title="Drop bank and credit card statements here, or click to choose them">+</div>
                <input type="file" id="pick" multiple accept=".pdf,.csv,.ofx,.qfx" hidden>
            </div>
            <div class="files" id="files"></div>

            <div class="boxes" id="boxes"></div>

            <div class="tiprow" id="tips"></div>
            <div class="tiprow needs" id="needs" hidden></div>

            <div class="stats" id="stats"></div>

            <div class="sub">30 days <span class="r" id="hist-note"></span></div>
            <div class="chart-wrap" id="c0wrap"><div class="tipbox" id="tip0"></div></div>
            <div class="legend" id="leg0"></div>

            <div class="sub">Spending <span class="r">what went out, by kind</span></div>
            <div class="chart-wrap" id="c3wrap"><div class="tipbox" id="tip3"></div></div>
            <div class="legend" id="leg3"></div>
            <div class="tiprow catrow" id="catrow" hidden></div>

            <div class="sub">Cash <span class="r">30 days back, 30 ahead · what comes in, what goes out</span></div>
            <div class="chart-wrap" id="c1wrap"><div class="tipbox" id="tip1"></div></div>
            <div class="legend" id="leg1"></div>
            <div class="monthend" id="monthend"></div>

            <div class="sub">What if I spend…</div>
            <div class="plans" id="plans"></div>
            <div class="effect" id="effect"></div>

            <div class="sub">Goals <span class="r">in order · the dot is the target, the tick is on pace</span></div>
            <div class="ladder" id="ladder" hidden></div>

            <details>
                <summary>Goals, assumptions and bills</summary>
                <div class="goals" id="goals"></div>
                <div class="incomes" id="incomes"></div>
                <div class="cards" id="cards"></div>
                <div class="assume" id="assume"></div>
                <div class="bills" id="bills"></div>
                <div class="note">The projection starts from your last day with cash, savings and debt entered and walks forward a day at a time: income on its days, everyday spending, these bills on their days (one marked <b>pays debt</b> moves cash to the debt instead), interest on the cards (at the blended APR of the cards listed) and the line of credit, the monthly moves into savings and the house fund. On the sweep day, whatever cash sits above the floor goes to the debt, dearest balance first; a day that ends below zero draws the line of credit, the way overdraft cover does. Leave a setting at 0 and it counts for nothing.</div>
            </details>
        </div>`;
    root.innerHTML = '<style>' + CSS + '</style>' + MARKUP;
    const $ = id => root.getElementById(id);
    const fin = $('fin');
    const syncTheme = () => fin.classList.toggle('dark', document.body.classList.contains('dark'));
    syncTheme();
    new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // ---------- state ----------
    const FIELDS = ['cash', 'savings', 'debt', 'invest'];
    const DEFAULT_ASSUME = { income: 0, spend: 0, debtApr: 0, cardApr: 0, locApr: 0, locCap: 0, locBalance: 0, debtStart: 0, carGoal: 0, cashFloor: 0, sweepDay: 0,
        saveAdd: 0, houseAdd: 0, houseGoal: 0, house: 0, saveApy: 0, hysaApy: 0, investReturn: 0, saveGoal: 0 };
    let S = { entries: {}, assume: Object.assign({}, DEFAULT_ASSUME), bills: [], planned: [], goals: [], incomes: [], cards: [], history: null, statements: [], tip: null, questions: [], categories: {}, nextId: 1 };
    function take(d) {
        TODAY = d.today; yearEnd = `${TODAY.slice(0, 4)}-12-31`;
        S.entries = d.entries || {};
        S.assume = Object.assign({}, DEFAULT_ASSUME, (d.plan || {}).assume);
        S.bills = ((d.plan || {}).bills || []).map(b => Object.assign({}, b));
        S.planned = ((d.plan || {}).planned || []).map(p => Object.assign({}, p));
        S.goals = ((d.plan || {}).goals || []).map(g => Object.assign({}, g));
        S.incomes = ((d.plan || {}).incomes || []).map(g => Object.assign({}, g));
        S.cards = ((d.plan || {}).cards || []).map(c => Object.assign({}, c));
        S.nextId = S.planned.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
        S.statements = d.statements || [];
        S.due = d.statements_due || [];
        S.tip = d.tip || null;
        S.questions = d.questions || [];
        S.categories = d.categories || {};
    }
    const say = (t, bad) => { const el = $('state'); el.textContent = t; el.className = 'state ' + (bad ? 'err' : 'saved'); if (!bad) setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, 1600); };
    let planTimer = null;
    const persist = () => {
        clearTimeout(planTimer);
        planTimer = setTimeout(async () => {
            try { await call('/plan', { method: 'PUT', body: { assume: S.assume, bills: S.bills, planned: S.planned, goals: S.goals, incomes: S.incomes, cards: S.cards } }); }
            catch (e) { say(e.message || 'not saved', true); }
        }, 600);
    };

    // ---------- dates ----------
    const DAY = 86400000;
    const pad = n => String(n).padStart(2, '0');
    const key = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const parse = k => new Date(k + 'T00:00:00Z');
    const add = (k, n) => key(new Date(parse(k).getTime() + n * DAY));
    const diff = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
    let TODAY = '', yearEnd = '';
    const dim = k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
    const dom = k => +k.slice(8, 10);
    const fmtDay = (k, o) => parse(k).toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC' }, o));
    const money = (n, short) => {
        const v = Math.round(n), a = Math.abs(v);
        const s = short && a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : a.toLocaleString();
        return (v < 0 ? '−$' : '$') + s;
    };
    const esc = t => { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML.replace(/"/g, '&quot;'); };

    // ---------- engine (from the mockup) ----------
    // ---------- the projection ----------
    // Money coming in: a monthly one lands on its day; a one-time one on its date.
    const incomeHits = (inc, d, day, last) => inc.amount > 0 && !inc.off && !(inc.until && d > inc.until)
        && (inc.date ? inc.date === d : Math.min(inc.day || 1, last) === day);
    // What is still owed on the 0% payment plans after day d: those dollars sit inside "debt" but earn no interest.
    function planLeft(d, bills) {
        let left = 0;
        for (const b of bills) {
            if (!b.debt || !b.until || b.off || b.until < d) continue;
            let n = 0; for (let m = d.slice(0, 7); m <= b.until.slice(0, 7); m = add(m + '-01', 32).slice(0, 7)) { const pd = m + '-' + pad(Math.min(b.day, dim(m + '-01'))); if (pd > d && pd <= b.until && !(b.from && pd < b.from)) n++; }
            left += n * b.amount;
        }
        return left;
    }
    // One day of the projection. Debt is one pool: the 0% plans, the cards and the line of credit (loc, tracked on
    // its own so interest and the sweep can tell them apart). Spending comes out of cash; a bill marked "pays debt"
    // moves cash to debt; on the sweep day whatever cash is above the floor goes to the debt, dearest first; a day
    // that ends below zero draws the line of credit (it is wired as overdraft cover) up to its cap.
    function stepDay(st, d, A, bills, spendCut, planned, incomes) {
        incomes = incomes || [];
        const o = { cash: st.cash, savings: st.savings, debt: st.debt, invest: st.invest, house: st.house, loc: st.loc || 0, sweep: 0, draw: 0 };
        const day = dom(d), last = dim(d);
        if (A.income && (day === 1 || day === 15)) o.cash += A.income / 2;
        for (const inc of incomes) if (incomeHits(inc, d, day, last)) o.cash += inc.amount;
        o.cash -= Math.max(0, A.spend - spendCut);
        const payDebt = (amt) => {   // the dearer balance first
            const pay = Math.min(amt, o.debt); if (pay <= 0) return 0;
            o.cash -= pay; o.debt -= pay;
            const cardApr = cardRate(A), cards = Math.max(0, o.debt + pay - o.loc - planLeft(d, bills));
            if (A.locApr >= cardApr) o.loc -= Math.min(pay, o.loc); else o.loc -= Math.max(0, Math.min(o.loc, pay - cards));
            return pay;
        };
        for (const b of bills) {
            if (Math.min(b.day, last) !== day) continue;
            if (b.off || (b.from && d < b.from) || (b.until && d > b.until)) continue;   // switched off, or a payment plan that has ended
            if (b.debt) { const pay = Math.min(b.amount, o.debt); o.cash -= pay; o.debt -= pay; }   // a plan instalment pays its own plan, never the line
            else o.cash -= b.amount;
        }
        for (const p of planned) {
            if (!p.on || !p.amount) continue;
            const hit = p.date === d || (p.monthly && d > p.date && Math.min(dom(p.date), last) === day);
            if (hit) o.cash -= p.amount;
        }
        if (day === 1) { const mv = A.saveAdd + A.houseAdd; o.cash -= mv; o.savings += mv; o.house += A.houseAdd; }
        if (A.sweepDay && Math.min(A.sweepDay, last) === day && o.debt > planLeft(d, bills) + 0.5) o.sweep = payDebt(o.cash - A.cashFloor);
        if (o.cash < 0 && A.locCap > 0) { const draw = Math.min(-o.cash, Math.max(0, A.locCap - o.loc)); o.cash += draw; o.loc += draw; o.debt += draw; o.draw = draw; }
        const cardApr = cardRate(A) / 100 / 365, locApr = (A.locApr || 0) / 100 / 365;
        const cards = Math.max(0, o.debt - o.loc - planLeft(d, bills));
        const interest = cards * cardApr + o.loc * locApr;
        o.debt += interest; o.loc += o.loc * locApr; o.interest = interest;
        o.savings += o.savings * (A.saveApy / 100) / 365;
        o.invest += o.invest * (A.investReturn / 100) / 365;
        return o;
    }
    function runSim(base, from, days, opts) {
        opts = opts || {};
        const A = opts.assume || S.assume, bills = opts.bills || S.bills;
        const planned = opts.planned === false ? [] : S.planned;
        let st = Object.assign({}, base), rows = [];
        for (let i = 1; i <= days; i++) {
            const d = add(from, i);
            const cut = opts.cut && d > TODAY && diff(TODAY, d) <= opts.cut.days ? opts.cut.amount : 0;
            st = stepDay(st, d, A, bills, cut, planned, opts.incomes || S.incomes);
            if (opts.cut && d > TODAY && diff(TODAY, d) === opts.cut.days) st.debt = Math.max(0, st.debt - opts.cut.amount * opts.cut.days);   // the money kept goes on the card
            rows.push(Object.assign({ date: d }, st));
        }
        return rows;
    }
    // A day counts for the projection once cash, savings and debt are in; trading is optional.
    const isFull = e => !!e && ['cash', 'savings', 'debt'].every(f => typeof e[f] === 'number');
    const netOf = (r, inv) => r.cash + r.savings - r.debt + (inv ? (r.invest || 0) : 0);

    // The last complete day of entries is where the projection starts.
    function baseDay() {
        const days = Object.keys(S.entries).filter(d => isFull(S.entries[d]) && d <= TODAY).sort();
        if (!days.length) return null;
        const d = days[days.length - 1], e = S.entries[d];
        return { date: d, state: { cash: e.cash, savings: e.savings, debt: e.debt, invest: e.invest || 0, house: S.assume.house, loc: Math.min(S.assume.locBalance || 0, e.debt) } };
    }
    const debtFree = rows => { const r = rows.find(x => x.debt <= 0.5); return r ? r.date : null; };

    // ---------- model snapshot, rebuilt on every change ----------
    let M;
    function model() {
        const base = baseDay();
        const m = { base };
        if (!base) { m.empty = true; return m; }
        m.horizon = Math.max(420, diff(base.date, TODAY) + 400);
        m.plain = runSim(base.state, base.date, m.horizon, { planned: false });
        m.withPlan = runSim(base.state, base.date, m.horizon, {});
        m.freeDate = debtFree(m.plain);
        m.freePlanDate = debtFree(m.withPlan);
        return m;
    }
    const simAt = (rows, base, d) => rows[diff(base.date, d) - 1];

    // ---------- entry bar ----------
    let selDay = '', saveTimer = null;
    const parseMoney = v => { const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null; };
    function fillEntry() {
        const e = S.entries[selDay] || {};
        root.querySelectorAll('#entry input[data-f]').forEach(inp => {
            const f = inp.dataset.f;
            inp.value = typeof e[f] === 'number' ? e[f].toLocaleString() : '';
        });
        const k = diff(selDay, TODAY);
        const lbl = esc(fmtDay(selDay, { month: 'short', day: 'numeric' }));
        $('dayWord').innerHTML = k === 0 ? `<b>${lbl}</b>` : lbl;
        $('dayWord').title = fmtDay(selDay, { weekday: 'long', month: 'long', day: 'numeric' }) + (k === 0 ? ' (today)' : '');
        $('next').disabled = selDay >= TODAY;
        $('prev').disabled = diff(selDay, TODAY) >= 29;
    }
    function onType() {
        $('state').textContent = 'typing…'; $('state').className = 'state';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(commitEntry, 500);
    }
    let chain = Promise.resolve();
    function commitEntry() {
        const day = selDay, body = {};
        root.querySelectorAll('#entry input[data-f]').forEach(inp => { const v = parseMoney(inp.value); body[inp.dataset.f] = v === null ? null : v; });
        const e = Object.assign({}, S.entries[day] || {});
        for (const f of FIELDS) { if (body[f] === null) delete e[f]; else e[f] = body[f]; }
        if (Object.keys(e).length) S.entries[day] = e; else delete S.entries[day];
        refresh(false);
        chain = chain.then(async () => {
            try {
                const out = await call(`/entries/${day}`, { method: 'PUT', body });
                if (Object.keys(out.entry).length) S.entries[day] = out.entry; else delete S.entries[day];
                say('saved'); refresh(false);
            } catch (err) { say(err.message || 'not saved', true); }
        });
    }

    // ---------- thirty days ----------
    function drawBoxes() {
        let on = 0;
        const cells = [];
        for (let k = -29; k <= 0; k++) {
            const d = add(TODAY, k), e = S.entries[d];
            const any = !!e && FIELDS.some(f => typeof e[f] === 'number');
            if (any) on++;
            cells.push(`<div class="b ${any ? 'on' : ''}${k === 0 ? ' today' : ''}${d === selDay ? ' sel' : ''}" data-d="${d}" title="${esc(fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' }))}${any ? '' : ' — nothing entered'}"></div>`);
        }
        $('boxes').innerHTML = cells.join('');
    }

    // ---------- the one tip-or-alert row, written by Tom ----------
    function drawTips() {
        const t = S.tip, row = $('tips');
        if (!t) { row.className = 'tiprow idle'; row.innerHTML = '<span class="txt">Nothing to flag right now. Tom looks over your numbers each morning.</span>'; return; }
        row.className = 'tiprow ' + t.kind;
        row.innerHTML = `<span class="chip">${t.kind === 'alert' ? 'ALERT' : 'TIP'}</span><span class="txt">${esc(t.body)}</span>
            <span class="fb"><button data-fb="up" title="Helpful — Tom brings you more like this">Useful</button><button data-fb="no" title="Not for me — Tom brings you fewer like this">Not for me</button></span>`;
        row.querySelectorAll('[data-fb]').forEach(b => b.addEventListener('click', async () => {
            const id = t.id; S.tip = null; drawTips();
            try { await call(`/api/finance/tips/${id}`, { method: 'PUT', body: { feedback: b.dataset.fb } }); } catch (e) { say(e.message || 'not saved', true); }
        }));
    }

    // ---------- stats ----------
    function drawStats() {
        if (M.empty) { $('stats').innerHTML = ''; return; }
        const t = isFull(S.entries[TODAY]) ? S.entries[TODAY] : simAt(M.plain, M.base, TODAY) || M.base.state;
        const net = t.cash + t.savings - t.debt;
        const free = M.freeDate, A = S.assume;
        const loc = TODAY > M.base.date ? (simAt(M.plain, M.base, TODAY) || {}).loc || 0 : M.base.state.loc || 0;
        const pct = (v, g) => g > 0 ? Math.min(100, Math.max(0, v / g * 100)) : 0;
        $('stats').innerHTML = `
            <div class="stat"><div class="k"><span class="sw" style="background:${INK}"></span>Net</div><div class="v">${money(net)}</div></div>
            <div class="stat"><div class="k">Debt-free</div><div class="v">${free ? esc(fmtDay(free, { month: 'short', day: 'numeric', year: free.slice(0, 4) !== TODAY.slice(0, 4) ? '2-digit' : undefined })) : 'not yet'}</div></div>
            <div class="stat"><div class="k"><span class="sw" style="background:var(--debtc)"></span>Debt left</div><div class="v">${money(t.debt)}</div></div>
            <div class="stat"><div class="k"><span class="sw" style="background:${SAV}"></span>Savings</div><div class="v">${money(t.savings)}</div>${A.saveGoal ? `<div class="bar" title="Savings goal ${money(A.saveGoal)}"><i style="width:${pct(t.savings, A.saveGoal)}%"></i></div>` : ''}</div>
            ${A.locCap ? `<div class="stat"><div class="k">Line of credit</div><div class="v">${money(loc)}</div><div class="bar" title="Of ${money(A.locCap)} available"><i style="width:${pct(loc, A.locCap)}%;background:var(--debtc)"></i></div></div>` : ''}`;
    }

    // ---------- what the pane needs from you ----------
    // Not Tom's row: these are the pane's own asks, computed from what it can see. A statement older than ten days,
    // balances not entered for three, a card APR of zero while cards carry a balance, a goal without a number.
    const ACCT_NAME = { becu_checking: 'BECU checking', becu_visa: 'BECU Visa', bofa: 'Bank of America', apple: 'Apple Card' };
    // Each ask is { text } (just words), { text, key, unit } (a number the pane wants, typed straight into that
    // assumption, like the health pane's boxes) or { q } (one of Tom's questions, answered in place).
    // One row, one ask at a time (Kevin, 2026-10-10): the pane's blocking asks first (nothing to project from),
    // then Tom's open question, then the pane's softer ones. The next appears once this one is answered.
    function needs() {
        const out = [], A = S.assume, H = S.history;
        const accts = (H && H.accounts) || {};
        if (!Object.keys(accts).length) out.push({ text: 'No statements yet. Drop your checking and card exports in the + circle and the past half of the charts fills in.' });
        const fullDays = Object.keys(S.entries).filter(d => isFull(S.entries[d]) && d <= TODAY).sort(), lastFull = fullDays[fullDays.length - 1];
        if (!lastFull) out.push({ text: 'Enter cash, savings and debt for a day and the projection starts.' });
        for (const q of S.questions) if (q.kind !== 'category') out.push({ q });
        if (Object.keys(accts).length) for (const k of Object.keys(ACCT_NAME)) {
            const a = accts[k];
            if (!a) { out.push({ text: `No ${ACCT_NAME[k]} statement yet. Drop one in the + circle.` }); continue; }
            // With a close day known (the card's "closes" column; checking at month end) the ask is about the
            // statement that closed; otherwise about how old the newest row is.
            const due = (S.due || []).find(x => x.acct === k && x.closes);
            if (due) { if (due.due && due.days_since >= 2) out.push({ text: `Your ${ACCT_NAME[k]} statement closed ${fmtDay(due.closed, { month: 'short', day: 'numeric' })}. Drop the export in the + circle.` }); continue; }
            const age = diff(a.last, TODAY);
            if (age > 10) out.push({ text: `Your ${ACCT_NAME[k]} statement ends ${fmtDay(a.last, { month: 'short', day: 'numeric' })}, ${age} days ago. Drop a newer export in the + circle.` });
        }
        if (lastFull && diff(lastFull, TODAY) >= 3) out.push({ text: `Balances were last entered ${fmtDay(lastFull, { month: 'short', day: 'numeric' })}. Today’s cash, savings and debt keep the projection honest.` });
        if (!M.empty) {
            const cards = M.base.state.debt - (M.base.state.loc || 0) - planLeft(M.base.date, S.bills);
            if (cards > 50 && !cardRate(A) && !S.questions.some(q => q.key === 'cardApr')) out.push({ text: 'What APR do your cards charge? Then the pane can say whether a balance belongs on the line of credit.', key: 'cardApr', unit: '%' });
        }
        if (S.goals.some(g => !g.done && /\bcar\b/i.test(g.title)) && !A.carGoal && !S.questions.some(q => q.key === 'carGoal')) out.push({ text: 'What would the car cost? That puts it on the ladder below.', key: 'carGoal', unit: '$' });
        return out.slice(0, 1);
    }
    const moneyBox = (unit, attrs) => unit === '%' ? `<span class="money pct"><input type="text" inputmode="decimal" ${attrs}><i>%</i></span>`
        : unit === 'day' ? `<span class="money pct"><input type="text" inputmode="numeric" ${attrs}><i>th</i></span>`
        : `<span class="money"><i>$</i><input type="text" inputmode="decimal" ${attrs}></span>`;
    // A number question's box: % for a rate, a day for a card's close day (key card.closes:<label>), else $.
    const unitOf = (key) => /apr|apy|return/i.test(key || '') ? '%' : /^card\.closes:/.test(key || '') ? 'day' : '$';
    function askHtml(n, i) {
        if (n.q) {
            const q = n.q, p = `<span class="who" title="Tom asked">TOM</span><span>${esc(q.prompt)}</span>`;
            if (q.kind === 'number') return `<div class="ask" data-qi="${i}">${p}${moneyBox(unitOf(q.key), 'data-ans="number"')}</div>`;
            if (q.kind === 'yesno') return `<div class="ask" data-qi="${i}">${p}<span class="fb"><button data-ans="yes">Yes</button><button data-ans="no">No</button></span></div>`;
            return `<div class="ask" data-qi="${i}">${p}<input type="text" class="line" data-ans="text" placeholder="One sentence, then Enter"></div>`;
        }
        if (n.key) return `<div class="ask" data-ni="${i}"><span>${esc(n.text)}</span>${moneyBox(n.unit, `data-key="${n.key}"`)}</div>`;
        return `<div>${esc(n.text)}</div>`;
    }
    async function answer(q, value) {
        S.questions = S.questions.filter(x => x.id !== q.id);
        if (q.kind === 'number' && q.key && Object.prototype.hasOwnProperty.call(DEFAULT_ASSUME, q.key)) { S.assume[q.key] = value; persist(); drawAssume(); }
        // A card question (key card.limit:<label> etc.): the server puts the number on the card; mirror it
        // here so a later persist() of the plan does not write the old card back over it.
        const ck = /^card\.(limit|apr|closes):(.+)$/.exec(q.key || '');
        if (q.kind === 'number' && ck) { const c = S.cards.find(x => String(x.label).toLowerCase() === ck[2].toLowerCase()); if (c) { c[ck[1]] = ck[1] === 'closes' ? Math.round(value) : value; drawCards(); } }
        drawNeeds(); drawCatRow();
        try {
            await call(`/api/finance/questions/${q.id}`, { method: 'PUT', body: { answer: String(value) } });
            say('saved');
            if (q.kind === 'category') { try { S.history = await call('/history?days=' + (HIST_BACK + 1)); } catch (e) { /* keep what we had */ } }
            refresh(false);
        } catch (e) { say(e.message || 'not saved', true); }
    }
    function drawNeeds() {
        const row = $('needs'), list = M ? needs() : [];
        row.hidden = !list.length;
        row.innerHTML = list.length ? `<span class="chip">NEEDS</span><div class="txt">${list.map(askHtml).join('')}</div>` : '';
        row.querySelectorAll('[data-key]').forEach(inp => {
            const commit = () => { const v = parseMoney(inp.value); if (v === null) return; S.assume[inp.dataset.key] = v; persist(); say('saved'); refresh(false); drawAssume(); };
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
            inp.addEventListener('change', commit);
        });
        row.querySelectorAll('.ask[data-qi]').forEach(el => {
            const q = list[+el.dataset.qi].q;
            el.querySelectorAll('button[data-ans]').forEach(b => b.addEventListener('click', () => answer(q, b.dataset.ans)));
            const inp = el.querySelector('input[data-ans]');
            if (!inp) return;
            const commit = () => { const raw = inp.value.trim(); if (!raw) return; if (inp.dataset.ans === 'number') { const v = parseMoney(raw); if (v === null) return; answer(q, v); } else answer(q, raw); };
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
            inp.addEventListener('change', commit);
        });
    }
    // Under the spending chart: Tom's "what was this?" questions, one line each, the categories he thinks fit as
    // ticks plus "other" with a box for Kevin's own word. One tick answers. One question at a time here too.
    function drawCatRow() {
        const row = $('catrow'), qs = S.questions.filter(q => q.kind === 'category').slice(0, 1);
        row.hidden = !qs.length;
        if (!qs.length) { row.innerHTML = ''; return; }
        row.innerHTML = `<span class="chip">TOM</span><div class="txt">` + qs.map((q, i) => {
            const opts = (q.options || []).filter(o => o !== 'other');
            return `<div class="q" data-i="${i}"><div>${esc(q.prompt)}</div><div class="opts">${opts.map(o => `<label><input type="checkbox" data-cat="${esc(o)}">${esc(catInfo(o)[0])}</label>`).join('')}<label><input type="checkbox" data-cat="other">other</label><input type="text" data-other placeholder="your word, then Enter" hidden></div></div>`;
        }).join('') + '</div>';
        row.querySelectorAll('.q').forEach(el => {
            const q = qs[+el.dataset.i], other = el.querySelector('[data-other]');
            el.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
                if (!cb.checked) return;
                el.querySelectorAll('input[type=checkbox]').forEach(x => { if (x !== cb) x.checked = false; });
                if (cb.dataset.cat === 'other') { other.hidden = false; other.focus(); return; }
                other.hidden = true; answer(q, cb.dataset.cat);
            }));
            const commit = () => { const v = other.value.trim().toLowerCase(); if (v) answer(q, v); };
            other.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
            other.addEventListener('change', commit);
        });
    }

    // ---------- the goals ladder ----------
    // The four goals in order, each a bar toward a green dot: the debt to zero by Dec 31, the savings floor, the car,
    // the house down payment. Titles come from plan.goals (Kevin's words); the numbers from the assumptions. Progress
    // is money, the small tick is where "on pace" would be today, and the right-hand words are where the projection
    // says it lands.
    function ladderRows() {
        if (M.empty) return [];
        const A = S.assume, now = isFull(S.entries[TODAY]) ? S.entries[TODAY] : simAt(M.plain, M.base, TODAY) || M.base.state;
        const title = (i, dflt) => (S.goals[i] && S.goals[i].title) || dflt;
        const startDay = Object.keys(S.entries).filter(d => typeof S.entries[d].debt === 'number').sort()[0] || M.base.date;
        const debtStart = A.debtStart || Math.max(now.debt, ...Object.values(S.entries).map(e => e.debt || 0));
        const rows = [];
        const paid = Math.max(0, debtStart - now.debt);
        const pace = yearEnd > startDay ? Math.min(1, Math.max(0, diff(startDay, TODAY) / diff(startDay, yearEnd))) : 1;
        rows.push({ title: title(0, 'Debt-free by Dec 31'), have: paid, goal: debtStart, pace, done: now.debt <= 0.5, left: `${money(now.debt)} left`,
            lands: M.freeDate ? (M.freeDate <= yearEnd ? `on course: ${fmtDay(M.freeDate, { month: 'short', day: 'numeric' })}` : `lands ${fmtDay(M.freeDate, { month: 'short', day: 'numeric', year: 'numeric' })}`) : 'not within a year as things stand', bad: !M.freeDate || M.freeDate > yearEnd });
        if (A.saveGoal) {
            const hit = M.plain.find(r => r.savings >= A.saveGoal);
            rows.push({ title: title(1, 'Savings'), have: now.savings, goal: A.saveGoal, done: now.savings >= A.saveGoal, left: `${money(now.savings)} of ${money(A.saveGoal)}`, lands: now.savings >= A.saveGoal ? 'reached' : hit ? `lands ${fmtDay(hit.date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'nothing is moving to savings yet', bad: !(now.savings >= A.saveGoal || hit) });
        }
        const carHave = Math.max(0, now.savings - (A.saveGoal || 0));
        rows.push({ title: title(2, 'A car'), have: carHave, goal: A.carGoal, done: A.carGoal && carHave >= A.carGoal, left: A.carGoal ? `${money(carHave)} of ${money(A.carGoal)}` : 'no budget set', lands: A.carGoal ? 'after the first two' : 'set a car budget under assumptions', bad: false });
        if (A.houseGoal) rows.push({ title: title(3, 'A house'), have: now.house || A.house || 0, goal: A.houseGoal, done: (now.house || 0) >= A.houseGoal, left: `${money(now.house || A.house || 0)} of ${money(A.houseGoal)}`, lands: A.houseAdd ? `${money(A.houseAdd)} a month from the 1st` : 'after the car', bad: false });
        return rows;
    }
    function drawLadder() {
        const rows = ladderRows(), box = $('ladder');
        box.hidden = !rows.length; if (!rows.length) { box.innerHTML = ''; return; }
        box.innerHTML = rows.map((r, i) => {
            const pct = r.goal > 0 ? Math.min(100, r.have / r.goal * 100) : 0;
            return `<div class="rung ${r.done ? 'done' : ''}"><div class="n">${i + 1}</div><div class="body"><div class="t"><span>${esc(r.title)}</span><span class="left">${esc(r.left)}</span></div>
                <div class="track"><i style="width:${pct}%"></i>${r.pace !== undefined && !r.done ? `<em style="left:${r.pace * 100}%" title="Where on pace would be today"></em>` : ''}<b title="The target"></b></div>
                <div class="lands ${r.bad ? 'bad' : ''}">${esc(r.lands)}</div></div></div>`;
        }).join('');
    }

    // ---------- charts ----------
    function niceTicks(lo, hi, n) {
        const span = (hi - lo) || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
        const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) out.push(Math.round(v * 100) / 100);
        return out;
    }
    const INK = 'var(--ink)', SAV = '#0ea5e9';
    // ---------- planned spending ----------
    function drawPlans() {
        $('plans').innerHTML = S.planned.map(p => `
            <div class="plan ${p.on ? '' : 'off'}" data-id="${p.id}">
                <input type="checkbox" data-k="on" ${p.on ? 'checked' : ''} title="Count it in the projection">
                <input type="text" data-k="label" value="${esc(p.label)}">
                <input type="date" data-k="date" value="${esc(p.date)}">
                <input type="text" data-k="amount" inputmode="decimal" value="${p.amount ? p.amount.toLocaleString() : ''}" placeholder="$ amount">
                <label class="every"><input type="checkbox" data-k="monthly" ${p.monthly ? 'checked' : ''}>monthly</label>
                <button class="x" data-k="del" title="Remove">×</button>
            </div>`).join('') + `
            <div class="plan add">
                <span></span><input type="text" id="np-label" placeholder="Something you might buy">
                <input type="date" id="np-date" value="${add(TODAY, 14)}">
                <input type="text" id="np-amount" inputmode="decimal" placeholder="$ amount">
                <span></span><button class="btn" id="np-add" style="padding:2px 8px">Add</button>
            </div>`;
        const row = el => S.planned.find(p => p.id === +el.closest('.plan').dataset.id);
        $('plans').querySelectorAll('.plan[data-id] [data-k]').forEach(el => {
            const ev = el.type === 'checkbox' || el.tagName === 'BUTTON' || el.type === 'date' ? 'change' : 'input';
            el.addEventListener(el.tagName === 'BUTTON' ? 'click' : ev, () => {
                const p = row(el), k = el.dataset.k;
                if (k === 'del') S.planned = S.planned.filter(x => x !== p);
                else if (k === 'on' || k === 'monthly') p[k] = el.checked;
                else if (k === 'amount') p.amount = parseMoney(el.value) || 0;
                else p[k] = el.value;
                persist();
                if (k === 'del' || k === 'on') { drawPlans(); }
                else if (k !== 'label') { /* amount and date redraw the charts as you type */ }
                refresh(false, true);
            });
        });
        const addIt = () => {
            const amount = parseMoney($('np-amount').value), label = $('np-label').value.trim();
            if (!amount || !$('np-date').value) return;
            S.planned.push({ id: S.nextId++, label: label || 'Planned spending', date: $('np-date').value, amount, on: true, monthly: false });
            persist(); drawPlans(); refresh(false, true);
        };
        $('np-add').addEventListener('click', addIt);
        $('np-amount').addEventListener('keydown', e => { if (e.key === 'Enter') addIt(); });
        drawEffect();
    }
    function drawEffect() {
        const on = S.planned.filter(p => p.on && p.amount);
        if (!M) return;
        if (M.empty || !on.length) { $('effect').textContent = on.length ? '' : 'Tick one on, or add something you are thinking of buying, and the dashed grey line shows what it does to your cash and to the year ahead.'; return; }
        const total = on.reduce((s, p) => s + p.amount * (p.monthly ? 1 : 1), 0);
        const d = yearEnd > M.base.date ? simAt(M.plain, M.base, yearEnd) : null, dp = d ? simAt(M.withPlan, M.base, yearEnd) : null;
        const shift = M.freeDate && M.freePlanDate ? diff(M.freeDate, M.freePlanDate) : null;
        $('effect').innerHTML = `With ${on.length === 1 ? 'this' : 'these ' + on.length}: <b>${d ? money(netOf(dp) - netOf(d)) : '—'}</b> on your net by Dec 31`
            + (shift !== null ? `, and the debt-free date ${shift === 0 ? 'does not move' : shift > 0 ? `moves <b>${shift} day${shift === 1 ? '' : 's'} later</b> (${esc(fmtDay(M.freePlanDate, { month: 'short', day: 'numeric', year: 'numeric' }))})` : 'moves earlier'}` : '')
            + '.';
    }

    // The cards' share of the debt pool accrues at the balance-weighted APR of the cards listed below (a card
    // with no balance weighs nothing); the Card APR assumption is the fallback when no card is listed.
    function cardRate(A) {
        let bal = 0, cost = 0;
        for (const c of S.cards) if (c.apr > 0 && c.balance > 0) { bal += c.balance; cost += c.balance * c.apr; }
        return bal > 0 ? cost / bal : (A.cardApr || A.debtApr || 0);
    }
    const AS = [['spend', 'Everyday spending a day', '$'], ['cardApr', 'Card APR, if no card is listed', '%'], ['locApr', 'Line of credit APR', '%'], ['locCap', 'Line of credit limit', '$'], ['locBalance', 'Drawn on the line now (inside debt)', '$'],
                ['cashFloor', 'Cash to keep in checking', '$'], ['sweepDay', 'Day the rest goes to the debt (0 = never)', ''], ['debtStart', 'Debt when you started', '$'],
                ['saveGoal', 'Savings goal', '$'], ['carGoal', 'Car budget', '$'], ['saveAdd', 'To savings, the 1st', '$'],
                ['houseAdd', 'To house fund, the 1st', '$'], ['houseGoal', 'House down payment goal', '$'], ['house', 'House fund now (inside savings)', '$'],
                ['saveApy', 'Your savings rate', '%'], ['hysaApy', 'A better savings rate', '%'], ['investReturn', 'Trading account return', '%']];
    function drawAssume() {
        $('assume').innerHTML = AS.map(([k, label]) => `<label>${label}<input type="text" inputmode="decimal" data-a="${k}" value="${S.assume[k] || ''}" placeholder="0"></label>`).join('');
        $('assume').querySelectorAll('input').forEach(el => el.addEventListener('input', () => {
            const v = el.value.trim() === '' ? 0 : parseMoney(el.value); if (v === null) return;
            S.assume[el.dataset.a] = v; persist(); refresh(false);
        }));
        drawGoals();
        drawIncomes();
        drawCards();
        drawBills();
    }
    // The cards, one row each: name, APR, balance now, limit. The blank line at the foot adds one.
    function drawCards() {
        const use = (c) => c.limit > 0 && c.balance > 0 ? `${Math.round(100 * c.balance / c.limit)}% of its limit` : c.limit > 0 ? 'nothing on it' : '';
        const rate = cardRate(S.assume);
        $('cards').innerHTML = `<div class="gtitle">Cards <span>${S.cards.length ? `balances accrue at ${rate.toFixed(2)}% blended · the sweep pays the dearest first` : 'name, APR, balance and limit'}</span></div>`
            + `<div class="card h"><span></span><span>APR</span><span>balance</span><span>limit</span><span title="Day of the month the statement closes. Tom reminds you to upload it a few days after.">closes</span><span></span><span></span></div>`
            + S.cards.map((c, i) => `<div class="card"><input type="text" data-c="label" data-i="${i}" value="${esc(c.label || '')}" placeholder="Card"><input type="text" inputmode="decimal" data-c="apr" data-i="${i}" value="${c.apr || ''}" placeholder="%"><input type="text" inputmode="decimal" data-c="balance" data-i="${i}" value="${c.balance || ''}" placeholder="$"><input type="text" inputmode="decimal" data-c="limit" data-i="${i}" value="${c.limit || ''}" placeholder="$"><input type="number" min="1" max="31" data-c="closes" data-i="${i}" value="${c.closes || ''}" placeholder="day" title="Day of the month the statement closes"><span class="use">${use(c)}</span><button class="x" data-c="del" data-i="${i}" title="Remove">×</button></div>`).join('')
            + `<div class="card new"><input type="text" id="card-new-label" placeholder="Add a card…"><input type="text" inputmode="decimal" id="card-new-apr" placeholder="%"><input type="text" inputmode="decimal" id="card-new-balance" placeholder="$"><input type="text" inputmode="decimal" id="card-new-limit" placeholder="$"><input type="number" min="1" max="31" id="card-new-closes" placeholder="day"><span></span><span></span></div>`;
        $('cards').querySelectorAll('[data-c]').forEach(el => {
            const ev = el.tagName === 'BUTTON' ? 'click' : 'input';
            el.addEventListener(ev, () => {
                const i = +el.dataset.i, k = el.dataset.c;
                if (k === 'del') { S.cards.splice(i, 1); persist(); drawCards(); refresh(false); return; }
                const c = S.cards[i];
                if (k === 'label') c.label = el.value;
                else { const v = el.value.trim() === '' ? 0 : parseMoney(el.value); if (v === null) return; c[k] = k === 'closes' ? Math.max(0, Math.min(31, Math.round(v))) : v; }
                persist(); refresh(false);
                const u = el.closest('.card').querySelector('.use'); if (u) u.textContent = use(c);
                $('cards').querySelector('.gtitle span').textContent = `balances accrue at ${cardRate(S.assume).toFixed(2)}% blended · the sweep pays the dearest first`;
            });
        });
        const addCard = () => {
            const label = $('card-new-label').value.trim(), apr = parseMoney($('card-new-apr').value), balance = parseMoney($('card-new-balance').value), limit = parseMoney($('card-new-limit').value), closes = parseMoney($('card-new-closes').value);
            if (!label || apr === null) return;
            S.cards.push({ label, apr, balance: balance || 0, limit: limit || 0, closes: closes ? Math.max(1, Math.min(31, Math.round(closes))) : 0 });
            persist(); drawCards(); refresh(false); const nl = $('card-new-label'); if (nl) nl.focus();
        };
        ['card-new-label', 'card-new-apr', 'card-new-balance', 'card-new-limit', 'card-new-closes'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCard(); } }));
        $('card-new-closes').addEventListener('change', addCard);
    }
    function drawGoals() {
        $('goals').innerHTML = `<div class="gtitle">Goals, in order <span>Tom works toward the first one that isn't done</span></div>`
            + S.goals.map((g, i) => `<div class="goal ${g.done ? 'done' : ''}"><input type="checkbox" data-g="done" data-i="${i}" ${g.done ? 'checked' : ''} title="Reached"><input type="text" data-g="title" data-i="${i}" value="${esc(g.title)}" placeholder="A goal"><button class="x" data-g="del" data-i="${i}" title="Remove">×</button></div>`).join('')
            + `<div class="goal-add"><button class="btn" id="goal-add">Add a goal</button></div>`;
        $('goals').querySelectorAll('[data-g]').forEach(el => {
            const ev = el.type === 'checkbox' ? 'change' : el.tagName === 'BUTTON' ? 'click' : 'input';
            el.addEventListener(ev, () => {
                const i = +el.dataset.i, k = el.dataset.g;
                if (k === 'del') { S.goals.splice(i, 1); persist(); drawGoals(); return; }
                if (k === 'done') { S.goals[i].done = el.checked; persist(); drawGoals(); return; }
                S.goals[i].title = el.value; persist();
            });
        });
        $('goal-add').addEventListener('click', () => { S.goals.push({ title: '', done: false }); persist(); drawGoals(); const ins = $('goals').querySelectorAll('input[data-g=title]'); if (ins.length) ins[ins.length - 1].focus(); });
    }
    function drawIncomes() {
        $('incomes').innerHTML = `<div class="gtitle">Income <span>monthly on a day, or once on a date</span></div>`
            + S.incomes.map((n, i) => `<div class="inc"><input type="text" data-n="label" data-i="${i}" value="${esc(n.label || '')}" placeholder="Where from"><input type="number" min="1" max="31" data-n="day" data-i="${i}" value="${n.day || ''}" placeholder="day" title="Day of the month it usually arrives"><input type="text" inputmode="decimal" data-n="amount" data-i="${i}" value="${n.amount || ''}" placeholder="$"><input type="date" data-n="date" data-i="${i}" value="${esc(n.date || '')}" title="Set a date for a one-time payment"><button class="x" data-n="del" data-i="${i}" title="Remove">×</button></div>`).join('')
            + `<div class="inc new"><input type="text" id="inc-new-label" placeholder="Add income…"><input type="number" min="1" max="31" id="inc-new-day" placeholder="day"><input type="text" inputmode="decimal" id="inc-new-amount" placeholder="$"><input type="date" id="inc-new-date" title="For a one-time payment"><span></span></div>`;
        $('incomes').querySelectorAll('[data-n]').forEach(el => {
            const ev = el.tagName === 'BUTTON' ? 'click' : 'input';
            el.addEventListener(ev, () => {
                const i = +el.dataset.i, k = el.dataset.n;
                if (k === 'del') { S.incomes.splice(i, 1); persist(); drawIncomes(); refresh(false); return; }
                const n = S.incomes[i];
                if (k === 'label') n.label = el.value;
                else if (k === 'date') { if (el.value) n.date = el.value; else delete n.date; }
                else { const v = parseMoney(el.value); if (v === null) return; n[k] = k === 'day' ? Math.max(1, Math.min(31, Math.round(v))) : v; }
                persist(); refresh(false);
            });
        });
        const addInc = () => {
            const label = $('inc-new-label').value.trim(), amount = parseMoney($('inc-new-amount').value), day = parseMoney($('inc-new-day').value), date = $('inc-new-date').value;
            if (!label || !amount) return;
            S.incomes.push(Object.assign({ label, amount }, date ? { date } : { day: Math.max(1, Math.min(31, Math.round(day || 1))) }));
            persist(); drawIncomes(); refresh(false); const nl = $('inc-new-label'); if (nl) nl.focus();
        };
        ['inc-new-label', 'inc-new-day', 'inc-new-amount'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addInc(); } }));
        $('inc-new-amount').addEventListener('change', addInc); $('inc-new-date').addEventListener('change', addInc);
    }
    function drawBills() {
        $('bills').innerHTML = `<div class="bill"><span></span><span class="h">Monthly expense</span><span class="h">day</span><span class="h">amount</span><span class="h">last payment</span><span class="h"></span><span></span></div>`
            + S.bills.map((b, i) => `<div class="bill ${b.off ? 'off' : ''}"><input type="checkbox" data-b="on" data-i="${i}" ${b.off ? '' : 'checked'} title="Counted. Untick it to see what cancelling it would do."><input type="text" data-b="label" data-i="${i}" value="${esc(b.label)}"><input type="number" min="1" max="31" data-b="day" data-i="${i}" value="${b.day}"><input type="text" inputmode="decimal" data-b="amount" data-i="${i}" value="${b.amount || ''}" placeholder="$"><input type="date" data-b="until" data-i="${i}" value="${esc(b.until || '')}" title="Leave empty for a bill that goes on. A payment plan ends here."><label class="debt" title="This payment lowers your debt"><input type="checkbox" data-b="debt" data-i="${i}" ${b.debt ? 'checked' : ''}>pays debt</label><button class="x" data-b="del" data-i="${i}" title="Remove">×</button></div>`).join('')
            + `<div class="bill new" title="Type a monthly charge here and press Enter"><span></span><input type="text" id="bill-new-label" placeholder="Add a monthly expense…"><input type="number" min="1" max="31" id="bill-new-day" placeholder="day"><input type="text" inputmode="decimal" id="bill-new-amount" placeholder="$"><span></span><span></span><span></span></div>`;
        $('bills').querySelectorAll('[data-b]').forEach(el => {
            const ev = el.type === 'checkbox' ? 'change' : el.tagName === 'BUTTON' ? 'click' : 'input';
            el.addEventListener(ev, () => {
                const i = +el.dataset.i, k = el.dataset.b;
                if (k === 'del') { S.bills.splice(i, 1); persist(); drawBills(); refresh(false); return; }
                const b = S.bills[i];
                if (k === 'label') b.label = el.value;
                else if (k === 'debt') b.debt = el.checked;
                else if (k === 'on') { if (el.checked) delete b.off; else b.off = true; el.closest('.bill').classList.toggle('off', !el.checked); }
                else if (k === 'until') { if (el.value) b.until = el.value; else delete b.until; }
                else { const v = parseMoney(el.value); if (v === null) return; b[k] = k === 'day' ? Math.max(1, Math.min(31, Math.round(v))) : v; }
                persist(); refresh(false);
            });
        });
        // The blank line at the foot: fill the name and the amount and it becomes a bill.
        const addBill = () => {
            const label = $('bill-new-label').value.trim(), amount = parseMoney($('bill-new-amount').value), day = parseMoney($('bill-new-day').value);
            if (!label || !amount) return;
            S.bills.push({ label, day: Math.max(1, Math.min(31, Math.round(day || 1))), amount, debt: false });
            persist(); drawBills(); refresh(false);
            const nl = $('bill-new-label'); if (nl) nl.focus();
        };
        ['bill-new-label', 'bill-new-day', 'bill-new-amount'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addBill(); } }));
        $('bill-new-amount').addEventListener('change', addBill);
    }

    // ---------- statements ----------
    function drawFiles() {
        $('drop').classList.toggle('has', S.statements.length > 0);
        $('drop').textContent = S.statements.length ? S.statements.length : '+';
        $('drop').title = S.statements.length ? `${S.statements.length} statements read. Drop more here, or click to choose them.` : 'Drop bank and credit card statements here, or click to choose them.';
    }
    async function takeFiles(list) {
        for (const f of [...list]) {
            say('uploading…');
            try {
                const res = await fetch(base + '/statements', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' }, body: f });
                const out = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(out.error || ('HTTP ' + res.status));
                S.statements.unshift(out); drawFiles(); say('saved'); try { S.history = await call('/history?days=' + (HIST_BACK + 1)); refresh(false); } catch (e) { /* the chart keeps what it had */ }
            } catch (e) { say(e.message || 'not uploaded', true); }
        }
    }

    // ---------- glue ----------
    // The chart's svg sits in its own box so the details panel can stand beside it (2026-10-10, Kevin: the floating
    // tooltip hid the chart). The panel shows today's day until a day is hovered, and goes back to it after.
    function putSvg(wrap, html) {
        let box = wrap.querySelector('.chart-svg');
        if (!box) { box = document.createElement('div'); box.className = 'chart-svg'; wrap.insertBefore(box, wrap.firstChild); }
        box.innerHTML = html; return box;
    }
    function hoverTips(wrap, tip, pts, html, ti) {
        const dflt = ti >= 0 ? html(pts[ti]) : '';
        tip.innerHTML = dflt;
        wrap.querySelectorAll('.hit').forEach(el => {
            el.addEventListener('mouseenter', () => { tip.innerHTML = html(pts[+el.dataset.i]); });
            el.addEventListener('mouseleave', () => { tip.innerHTML = dflt; });
        });
    }
    function showEmpty(id, msg) {
        const w = $(id); const old = w.querySelector('.chart-svg'); if (old) old.remove(); const t = w.querySelector('.tipbox'); if (t) t.innerHTML = '';
        let e = w.querySelector('.empty'); if (!e) { e = document.createElement('div'); e.className = 'empty'; w.insertBefore(e, w.firstChild); }
        e.textContent = msg; e.hidden = !msg;
    }
    const clearEmpty = id => { const e = $(id).querySelector('.empty'); if (e) e.remove(); };

    // ---------- cash: what comes in, what goes out ----------
    // Top: the cash balance (entered days, then the projection). Bottom: each day's flows, income up in orange,
    // what goes out stacked downward by kind. The month-end check under it says what extra income each month
    // would need for the debt to be gone by Dec 31.
    // Money by what it was for. Spending is counted when it happens, on any account (a card purchase is groceries on the
    // day, not when the card is paid), so card payments are not bars; the cash line still dips when you pay them.
    const CATS = {
        income: ['Income', 'var(--orange)'], medical: ['Medical', 'var(--pink)'], groceries: ['Groceries', '#eda100'], dining: ['Dining', 'var(--violet)'],
        travel: ['Travel', 'var(--blue)'], bills: ['Bills', '#38bdf8'], shopping: ['Shopping', '#b45309'], entertainment: ['Entertainment', '#0d9488'], dad: ['Dad', '#9f1239'], taxes: ['Taxes', '#475569'], other: ['Other', '#94a3b8']
    };
    const BUILT_OUT = ['groceries', 'dining', 'travel', 'shopping', 'entertainment', 'bills', 'medical', 'dad', 'taxes', 'other'];   // nearest the zero line first
    // A category Kevin typed himself gets a colour from this palette, in order of first appearance, and keeps it for the session.
    const EXTRA_COLOURS = ['#be123c', '#4d7c0f', '#7c3aed', '#a16207', '#0369a1', '#5b21b6'];
    const extraCats = [];
    const catInfo = k => { if (CATS[k]) return CATS[k]; if (!extraCats.includes(k)) extraCats.push(k); return [k.charAt(0).toUpperCase() + k.slice(1), EXTRA_COLOURS[(extraCats.indexOf(k)) % EXTRA_COLOURS.length]]; };
    // The outgoing categories, in drawing order: the built-ins, then his own words in the order they appeared.
    const outCats = pts => BUILT_OUT.concat(extraCats.slice()).concat(pts ? pts.reduce((acc, p) => { if (p.flows) Object.keys(p.flows.cats).forEach(k => { if (k !== 'income' && !CATS[k] && !acc.includes(k) && !extraCats.includes(k)) acc.push(k); }); return acc; }, []) : []);
    const OUT = BUILT_OUT;
    const billCat = (label) => /health|baptist|medical|bcbs|clinic|pharm|doctor|dental|therapy|hospital/i.test(label || '') ? 'medical' : 'bills';
    const matchesBill = (label) => S.bills.some(b => { const w = (b.label || '').toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 4)[0]; return w && String(label).toLowerCase().includes(w); });
    const outOf = (f) => Object.keys(f.cats).reduce((t, k) => t + (k === 'income' ? 0 : (f.cats[k] || 0)), 0);
    function flowsFor(d) {
        const day = dom(d), last = dim(d), f = { income: 0, cats: {}, rec: {}, items: [], moves: [], daily: 0 };
        const A = S.assume;
        const put = (cat, label, amt, rec) => { f.cats[cat] = (f.cats[cat] || 0) + amt; if (rec) f.rec[cat] = (f.rec[cat] || 0) + amt; f.items.push([cat, label, amt, !!rec]); };
        if (A.income && (day === 1 || day === 15)) { f.income += A.income / 2; f.items.push(['income', 'Pay', A.income / 2, false]); }
        for (const inc of S.incomes) if (incomeHits(inc, d, day, last)) { f.income += inc.amount; f.items.push(['income', inc.label || 'Income', inc.amount, true]); }
        for (const b of S.bills) {
            if (b.off || Math.min(b.day, last) !== day || (b.from && d < b.from) || (b.until && d > b.until)) continue;
            if (b.debt) f.moves.push(['card', b.label, b.amount]);   // pays debt: cash to debt, not spending
            else put(billCat(b.label), b.label, b.amount, true);
        }
        if (M && !M.empty && d > M.base.date) { const r = simAt(M.plain, M.base, d); if (r && r.sweep > 0.5) f.moves.push(['card', 'To the debt (what is above the cash floor)', r.sweep]); if (r && r.draw > 0.5) f.moves.push(['in', 'Drawn on the line of credit', r.draw]); }
        for (const p of S.planned) {
            if (!p.on || !p.amount) continue;
            if (p.date === d || (p.monthly && d > p.date && Math.min(dom(p.date), last) === day)) put('other', p.label, p.amount, !!p.monthly);
        }
        if (A.spend) {
            f.daily = A.spend;
            const sh = (S.history && S.history.shares) || {}, keys = Object.keys(sh);
            if (keys.length) keys.forEach(k => { f.cats[k] = (f.cats[k] || 0) + A.spend * sh[k]; }); else f.cats.other = (f.cats.other || 0) + A.spend;
        }
        return f;
    }
    function flowsFromHistory(d) {
        const h = S.history && S.history.days && S.history.days[d];
        const f = { income: 0, cats: {}, rec: {}, items: [], moves: [], daily: 0 };
        if (!h) return f;
        f.income = h.income; f.moves = h.moves || [];
        h.items.forEach(([cat, label, amt, rec]) => {
            if (cat === 'income') { f.items.push([cat, label, amt, false]); return; }
            const r = !!rec || matchesBill(label);
            f.cats[cat] = (f.cats[cat] || 0) + amt; if (r) f.rec[cat] = (f.rec[cat] || 0) + amt;
            f.items.push([cat, label, amt, r]);
        });
        return f;
    }
    const HIST_BACK = 30;   // the Cash chart's past half; the history request covers HIST_BACK + 1 days so day −30 is real, not interpolated
    function historySeries() {
        const out = []; const H = S.history && S.history.days || {};
        const anchorDay = Object.keys(S.entries).filter(d => d <= TODAY && typeof S.entries[d].cash === 'number').sort().pop();
        const net = d => (H[d] ? H[d].net : 0);
        const rel = !anchorDay;
        for (let k = -HIST_BACK; k <= 0; k++) {
            const d = add(TODAY, k); let cash;
            if (rel) { cash = 0; for (let x = add(TODAY, -HIST_BACK); x <= d; x = add(x, 1)) cash += net(x); }
            else if (d <= anchorDay) { cash = S.entries[anchorDay].cash; for (let x = add(d, 1); x <= anchorDay; x = add(x, 1)) cash -= net(x); }
            else { cash = S.entries[anchorDay].cash; for (let x = add(anchorDay, 1); x <= d; x = add(x, 1)) cash += net(x); }
            out.push({ d, k, cash: Math.round(cash * 100) / 100, kind: 'actual', plan: null, flows: flowsFromHistory(d) });
        }
        out.rel = rel;
        return out;
    }
    function cashSeries() {
        const out = [];
        const days = Object.keys(S.entries).filter(d => typeof S.entries[d].cash === 'number').sort();
        const fromStatements = {};
        if (S.history && S.history.has_checking) { const hs = historySeries(); if (!hs.rel) hs.forEach(p => { fromStatements[p.d] = p.cash; }); }
        for (let k = -30; k <= 30; k++) {
            const d = add(TODAY, k);
            let cash = null, kind = 'est', plan = null, flows = null;
            if (!M.empty && d > M.base.date && !(k <= 0 && fromStatements[d] !== undefined)) { const r = simAt(M.plain, M.base, d); cash = r.cash; kind = k <= 0 ? 'est' : 'proj'; if (k >= 0) plan = simAt(M.withPlan, M.base, d).cash; }
            else if (typeof (S.entries[d] || {}).cash === 'number') { cash = S.entries[d].cash; kind = 'actual'; }
            else if (k <= 0 && fromStatements[d] !== undefined) { cash = fromStatements[d]; kind = 'actual'; }
            else {
                const before = [...days].reverse().find(x => x < d), after = days.find(x => x > d);
                if (before && after) cash = S.entries[before].cash + (S.entries[after].cash - S.entries[before].cash) * diff(before, d) / diff(before, after);
                else if (before || after) cash = S.entries[before || after].cash;
            }
            if (k > 0) flows = flowsFor(d); else if (S.history && S.history.has_checking) flows = flowsFromHistory(d);
            out.push({ d, k, cash, kind, plan, flows });
        }
        return out;
    }
    function drawCash() {
        const haveCash = Object.keys(S.entries).some(d => typeof S.entries[d].cash === 'number');
        const hist = S.history && S.history.has_checking;
        const anyPlan = S.planned.some(p => p.on && p.amount) && !M.empty;
        if (!hist && M.empty) { showEmpty('c0wrap', 'Drop your BECU checking statement in the + circle, or enter cash for a day, and the next 30 days appear here.'); $('leg0').innerHTML = ''; showEmpty('c3wrap', ''); $('leg3').innerHTML = ''; }
        else { clearEmpty('c0wrap'); clearEmpty('c3wrap'); const near = cashSeries().filter(p => Math.abs(p.k) <= 15); renderFlowChart({ wrapId: 'c0wrap', tipId: 'tip0', legId: 'leg0', pts: near, anyPlan }); renderSpendChart({ wrapId: 'c3wrap', tipId: 'tip3', legId: 'leg3', pts: near }); }
        if (M.empty && !haveCash) { showEmpty('c1wrap', 'Enter your cash for a day and the cash picture appears.'); $('leg1').innerHTML = ''; return; }
        clearEmpty('c1wrap');
        renderCash({ wrapId: 'c1wrap', tipId: 'tip1', legId: 'leg1', pts: cashSeries(), anyPlan, band: [-15, 15] });
    }
    // Bars on a linear scale (2026-10-10; the square-root scale flattered big days). Each direction's scale is set by
    // the second-largest day, at least $500, so one airline day cannot squash a month of groceries: a bar over the
    // cap is clipped, notched, and labelled with its total.
    function flowCap(vals) { const s = vals.filter(v => v > 0).sort((a, b) => b - a); return Math.max(500, s[1] || s[0] || 0); }
    const MOVE_LABEL = { card: 'card payment', in: 'moved in', out: 'moved out' };
    const hatchId = k => k.replace(/[^a-z0-9]+/g, '-');
    const hatchDefs = (cats, scope) => '<defs>' + cats.concat(['income']).map(k => `<pattern id="hat-${scope}-${hatchId(k)}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="${catInfo(k)[1]}"/><rect width="2" height="5" fill="#fff" fill-opacity="0.72"/></pattern>`).join('') + '</defs>';
    // One day's line items for the side panel: purchases by kind, then the moves that are not spending.
    function dayItems(f, kind) {
        let h = '';
        f.items.forEach(([cat, label, amt, rec]) => { h += `<div><span class="sw" style="background:${catInfo(cat)[1]}"></span><span>${esc(label)}${rec && cat !== 'income' ? ' <i>recurring</i>' : ''}</span><b>${cat === 'income' ? '+' : '−'}${money(amt)}</b></div>`; });
        if (f.daily && kind === 'proj') h += `<div><span></span><span>Everyday spending</span><b>−${money(f.daily)}</b></div>`;
        (f.moves || []).forEach(([k, label, amt]) => { h += `<div><span class="sw" style="background:#94a3b8"></span><span>${esc(label)} <i>${MOVE_LABEL[k] || k}</i></span><b>${k === 'in' ? '+' : '−'}${money(amt)}</b></div>`; });
        return h;
    }
    // Spending only (2026-10-10, Kevin: the small bars in the 30-day chart were too small to read). Same 30 days,
    // same categories and hatch, bars upward, no income and no cash line, so the scale is set by the spending.
    function renderSpendChart(cfg) {
        const wrap = $(cfg.wrapId), tip = $(cfg.tipId), pts = cfg.pts;
        const W = 600, L = 40, R = 10, slot = (W - L - R) / pts.length, cx = i => L + slot * i + slot / 2;
        const TOP = 14, H1 = 150, LAB = 22, H = TOP + H1 + LAB;
        const fl = pts.filter(p => p.flows), cats = outCats(pts);
        const cap = Math.max(300, flowCap(fl.map(p => outOf(p.flows)))), unit = H1 / cap, y0 = TOP + H1;
        let g = hatchDefs(cats, cfg.wrapId);
        niceTicks(0, cap, 3).forEach(v => { if (v > 0 && v <= cap) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y0 - v * unit}" y2="${y0 - v * unit}"/><text x="${L - 5}" y="${y0 - v * unit + 3}" text-anchor="end">${money(v, true)}</text>`; });
        g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}"/>`;
        const bw = Math.max(4, slot * 0.72);
        let clipped = '';
        pts.forEach((p, i) => {
            if (!p.flows) return;
            const f = p.flows; let up = 0;
            const seg = (v, cat, hatched) => {
                if (v <= 0.005) return;
                const from = up, to = from + v, a = Math.min(from, cap), b = Math.min(to, cap);
                if (b > a) g += `<rect x="${cx(i) - bw / 2}" y="${y0 - b * unit}" width="${bw}" height="${Math.max(1, (b - a) * unit)}" fill="${hatched ? `url(#hat-${cfg.wrapId}-${hatchId(cat)})` : catInfo(cat)[1]}"${p.kind === 'proj' && !hatched ? ' fill-opacity="0.8"' : ''}/>`;
                up = to;
            };
            cats.forEach(k => { const tot = f.cats[k] || 0, rec = Math.min(tot, f.rec[k] || 0); seg(tot - rec, k, false); seg(rec, k, true); });
            if (up > cap) clipped += `<line x1="${cx(i) - bw / 2 - 1}" x2="${cx(i) + bw / 2 + 1}" y1="${TOP + 3}" y2="${TOP + 3}" stroke="#fff" stroke-width="2"/><text x="${cx(i)}" y="${TOP - 3}" text-anchor="middle" style="fill:#475569;font-weight:600">${money(up, true)}</text>`;
        });
        g += clipped;
        const ti = pts.findIndex(p => p.k === 0);
        g += `<line x1="${cx(ti)}" x2="${cx(ti)}" y1="${TOP}" y2="${TOP + H1}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 3"/>`;
        pts.forEach((p, i) => { if (i % 5 === 0 || i === pts.length - 1) g += `<text class="${p.k === 0 ? 'today' : ''}" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${p.k === 0 ? 'today' : fmtDay(p.d, { month: 'short', day: 'numeric' })}</text>`; });
        g += pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${TOP}" width="${slot}" height="${H1}"/>`).join('');
        putSvg(wrap, `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by kind, 15 days back and 15 ahead">${g}</svg>`);
        hoverTips(wrap, tip, pts, p => {
            const f = p.flows, o = f ? outOf(f) : 0;
            let h = `<div class="d">${esc(fmtDay(p.d, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${p.kind === 'proj' ? 'projected' : 'spent'} <b style="margin-left:auto">${money(o)}</b></div>`;
            if (f) f.items.forEach(([cat, label, amt, rec]) => { if (cat !== 'income') h += `<div><span class="sw" style="background:${catInfo(cat)[1]}"></span><span>${esc(label)}${rec ? ' <i>recurring</i>' : ''}</span><b>${money(amt)}</b></div>`; });
            if (f && f.daily && p.kind === 'proj') h += `<div><span></span><span>Everyday spending</span><b>${money(f.daily)}</b></div>`;
            return h;
        }, ti);
        const present = cats.filter(k => pts.some(p => p.flows && p.flows.cats[k]));
        $(cfg.legId).className = 'legend one';
        $(cfg.legId).innerHTML = present.map(k => `<span class="item"><span class="sw" style="background:${catInfo(k)[1]}"></span>${esc(catInfo(k)[0])}</span>`).join('') + '<span class="item" title="Hatched bars repeat every month"><span class="sw hatch"></span>recurring</span>';
    }
    function renderFlowChart(cfg) {
        const wrap = $(cfg.wrapId), tip = $(cfg.tipId), pts = cfg.pts, anyPlan = cfg.anyPlan;
        const W = 600, L = 40, R = 44, slot = (W - L - R) / pts.length, cx = i => L + slot * i + slot / 2;
        const TOP = 14, H1 = 176, LAB = 22, H = TOP + H1 + LAB;
        const fl = pts.filter(p => p.flows), cats = outCats(pts);
        const capIn = flowCap(fl.map(p => p.flows.income)), capOut = flowCap(fl.map(p => outOf(p.flows)));
        const unit = H1 / (capIn + capOut), y0 = TOP + capIn * unit;
        let g = hatchDefs(cats, cfg.wrapId);
        niceTicks(0, capIn, 2).forEach(v => { if (v > 0 && v <= capIn) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y0 - v * unit}" y2="${y0 - v * unit}"/><text x="${L - 5}" y="${y0 - v * unit + 3}" text-anchor="end">+${money(v, true)}</text>`; });
        niceTicks(0, capOut, 2).forEach(v => { if (v > 0 && v <= capOut) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y0 + v * unit}" y2="${y0 + v * unit}"/><text x="${L - 5}" y="${y0 + v * unit + 3}" text-anchor="end">−${money(v, true)}</text>`; });
        g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}"/>`;
        const bw = Math.max(4, slot * 0.72);
        let clipped = '';
        pts.forEach((p, i) => {
            if (!p.flows) return;
            const f = p.flows; let up = 0, down = 0;
            const seg = (v, cat, hatched, dirUp) => {
                if (v <= 0.005) return;
                const cap = dirUp ? capIn : capOut, from = dirUp ? up : down, to = from + v;
                const a = Math.min(from, cap), b = Math.min(to, cap);
                if (b > a) { const h = Math.max(1, (b - a) * unit), yy = dirUp ? y0 - b * unit : y0 + a * unit; g += `<rect x="${cx(i) - bw / 2}" y="${yy}" width="${bw}" height="${h}" fill="${hatched ? `url(#hat-${cfg.wrapId}-${hatchId(cat)})` : catInfo(cat)[1]}"${p.kind === 'proj' && !hatched ? ' fill-opacity="0.8"' : ''}/>`; }
                if (dirUp) up = to; else down = to;
            };
            seg(f.income, 'income', false, true);
            cats.forEach(k => { const tot = f.cats[k] || 0, rec = Math.min(tot, f.rec[k] || 0); seg(tot - rec, k, false, false); seg(rec, k, true, false); });
            if (up > capIn) clipped += `<line x1="${cx(i) - bw / 2 - 1}" x2="${cx(i) + bw / 2 + 1}" y1="${TOP + 3}" y2="${TOP + 3}" stroke="#fff" stroke-width="2"/><text x="${cx(i)}" y="${TOP - 3}" text-anchor="middle" style="fill:var(--orange);font-weight:600">${money(up, true)}</text>`;
            if (down > capOut) clipped += `<line x1="${cx(i) - bw / 2 - 1}" x2="${cx(i) + bw / 2 + 1}" y1="${TOP + H1 - 3}" y2="${TOP + H1 - 3}" stroke="#fff" stroke-width="2"/><text x="${cx(i)}" y="${TOP + H1 + 9}" text-anchor="middle" style="fill:#475569;font-weight:600">${money(down, true)}</text>`;
            // a card payment or a move between his accounts: a grey tick on the zero line, never a bar
            if (f.moves && f.moves.length) g += `<rect x="${cx(i) - 2}" y="${y0 - 5}" width="4" height="10" rx="1" fill="#94a3b8"/>`;
        });
        g += clipped;
        // the cash line: white with a dark edge so it reads over any bar colour; its zero is the bars' zero line
        const cv = pts.map(p => p.cash).filter(v => v !== null && v !== undefined);
        if (cv.length > 1) {
            const hiC = Math.max(100, Math.max.apply(null, cv) * 1.06), yc = v => y0 - v * (y0 - TOP) / hiC;
            niceTicks(0, hiC, 2).forEach(v => { if (v > 0 && v <= hiC) g += `<text x="${W - R + 5}" y="${yc(v) + 3}" style="fill:#64748b">${money(v, true)}</text>`; });
            g += `<text x="${W - R + 5}" y="${y0 + 3}" style="fill:#64748b">$0</text>`;
            let seg = [], dashed = false; const lines = [];
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                if (p.cash === null || p.cash === undefined) { if (seg.length > 1) lines.push({ pts: seg, dashed }); seg = []; continue; }
                const isProj = p.kind === 'proj';
                if (seg.length && isProj !== dashed) { lines.push({ pts: seg.concat([`${cx(i)},${yc(p.cash)}`]), dashed }); seg = [`${cx(i)},${yc(p.cash)}`]; dashed = isProj; continue; }
                dashed = isProj; seg.push(`${cx(i)},${yc(p.cash)}`);
            }
            if (seg.length > 1) lines.push({ pts: seg, dashed });
            lines.forEach(l => { g += `<polyline fill="none" stroke="#0f172a" stroke-opacity="0.5" stroke-width="4.6" stroke-linejoin="round" stroke-linecap="round" points="${l.pts.join(' ')}"/>`; });
            lines.forEach(l => { g += `<polyline fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"${l.dashed ? ' stroke-dasharray="5 3"' : ''} points="${l.pts.join(' ')}"/>`; });
            pts.forEach((p, i) => { if (p.kind === 'actual' && p.cash !== null) g += `<circle cx="${cx(i)}" cy="${yc(p.cash)}" r="2.4" fill="#ffffff" stroke="#0f172a" stroke-opacity="0.55" stroke-width="1"/>`; });
            const pp = pts.map((p, i) => ({ i, v: p.plan })).filter(q => q.v !== null && q.v !== undefined);
            if (anyPlan && pp.length > 1) g += `<polyline fill="none" stroke="var(--plan)" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round" points="${pp.map(q => `${cx(q.i)},${yc(q.v)}`).join(' ')}"/>`;
        }
        const ti = pts.findIndex(p => p.k === 0);
        g += `<line x1="${cx(ti)}" x2="${cx(ti)}" y1="${TOP}" y2="${TOP + H1}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 3"/>`;
        pts.forEach((p, i) => { if (i % 5 === 0 || i === pts.length - 1) g += `<text class="${p.k === 0 ? 'today' : ''}" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${p.k === 0 ? 'today' : fmtDay(p.d, { month: 'short', day: 'numeric' })}</text>`; });
        g += pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${TOP}" width="${slot}" height="${H1}"/>`).join('');
        putSvg(wrap, `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money in and out by category for 15 days back and 15 ahead, with the cash balance as a line">${g}</svg>`);
        hoverTips(wrap, tip, pts, p => {
            const f = p.flows;
            let h = `<div class="d">${esc(fmtDay(p.d, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${p.kind === 'actual' ? 'actual' : p.kind === 'est' ? 'estimated' : 'projected'}</div>`;
            if (p.cash !== null && p.cash !== undefined) h += `<div><span class="sw" style="background:#fff;box-shadow:0 0 0 1px #64748b"></span><span>Cash</span><b>${money(p.cash)}</b></div>`;
            if (p.plan !== null && p.plan !== undefined && anyPlan && Math.abs(p.plan - p.cash) > 0.5) h += `<div><span class="sw" style="background:var(--plan)"></span><span>With planned spending</span><b>${money(p.plan)}</b></div>`;
            if (f) h += dayItems(f, p.kind);
            return h;
        }, ti);
        // one line: the kinds that appear, the hatch, the grey tick, the white line
        const present = ['income'].concat(cats).filter(k => pts.some(p => p.flows && (k === 'income' ? p.flows.income : p.flows.cats[k])));
        const anyMove = pts.some(p => p.flows && p.flows.moves && p.flows.moves.length);
        $(cfg.legId).className = 'legend one';
        $(cfg.legId).innerHTML = present.map(k => `<span class="item"><span class="sw" style="background:${catInfo(k)[1]}"></span>${esc(catInfo(k)[0])}</span>`).join('')
            + '<span class="item" title="Hatched bars repeat every month"><span class="sw hatch"></span>recurring</span>'
            + (anyMove ? '<span class="item" title="A card payment or a move between your accounts: the cash line moves, nothing was bought"><span class="sw tick"></span>card payment</span>' : '')
            + '<span class="item"><span class="ln white"></span>cash</span>'
            + (anyPlan ? '<span class="item"><span class="ln"></span>planned</span>' : '');
    }
    function renderCash(cfg) {
        const wrap = $(cfg.wrapId), tip = $(cfg.tipId), pts = cfg.pts, anyPlan = cfg.anyPlan;
        const W = 600, L = 40, R = 44, slot = (W - L - R) / pts.length, cx = i => L + slot * i + slot / 2;
        const TOP = 12, H1 = 150, LAB = 20, H = TOP + H1 + LAB;
        const cv = pts.map(p => p.cash).filter(v => v !== null).concat(pts.map(p => p.plan).filter(v => v !== null), [0]);
        let lo = Math.min.apply(null, cv), hi = Math.max.apply(null, cv); const pad = (hi - lo) * 0.08 || 100; hi += pad; if (lo < 0) lo -= pad; else lo = 0;
        const t1 = niceTicks(lo, hi, 3); lo = Math.min(lo, t1[0]); hi = Math.max(hi, t1[t1.length - 1]);
        const y1 = v => TOP + H1 * (1 - (v - lo) / (hi - lo));
        let g = '';
        t1.forEach(v => { g += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y1(v)}" y2="${y1(v)}"/><text x="${L - 5}" y="${y1(v) + 3}" text-anchor="end">${money(v, true)}</text>`; });
        if (cfg.band) { const bi = pts.findIndex(p => p.k === cfg.band[0]), bj = pts.findIndex(p => p.k === cfg.band[1]); if (bi >= 0 && bj >= 0) g += `<rect x="${cx(bi) - slot / 2}" y="${TOP}" width="${cx(bj) - cx(bi) + slot}" height="${H1}" fill="var(--band)" stroke="var(--band)" stroke-width="1"><title>The 30 days shown in the chart above</title></rect>`; }
        // one ink line: solid where entered or read from statements, lighter where estimated, dashed where projected
        let run = null;
        const flush = () => { if (run) g += `<polyline fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${run.kind === 'proj' ? ' stroke-dasharray="5 3"' : ''}${run.kind === 'est' ? ' stroke-opacity="0.45"' : ''} points="${run.pts.join(' ')}"/>`; run = null; };
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1]; if (a.cash === null || b.cash === null) { flush(); continue; }
            const kind = (a.kind === 'proj' || b.kind === 'proj') ? 'proj' : (a.kind === 'est' || b.kind === 'est') ? 'est' : 'actual';
            if (!run || run.kind !== kind) { flush(); run = { kind, pts: [`${cx(i)},${y1(a.cash)}`] }; }
            run.pts.push(`${cx(i + 1)},${y1(b.cash)}`);
        }
        flush();
        pts.forEach((p, i) => { if (p.kind === 'actual') g += `<circle cx="${cx(i)}" cy="${y1(p.cash)}" r="2.3" fill="${INK}"/>`; });
        pts.forEach((p, i) => { if (p.flows && p.flows.moves && p.flows.moves.some(m => m[0] === 'card')) g += `<rect x="${cx(i) - 1.5}" y="${TOP + H1 - 8}" width="3" height="8" rx="1" fill="#94a3b8"><title>Card payment</title></rect>`; });
        const pp = pts.map((p, i) => ({ i, v: p.plan })).filter(q => q.v !== null);
        if (anyPlan && pp.length > 1) g += `<polyline fill="none" stroke="var(--plan)" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round" points="${pp.map(q => `${cx(q.i)},${y1(q.v)}`).join(' ')}"/>`;
        const ti = pts.findIndex(p => p.k === 0);
        g += `<line x1="${cx(ti)}" x2="${cx(ti)}" y1="${TOP}" y2="${TOP + H1}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 3"/>`;
        pts.forEach((p, i) => { if (i % 10 === 0 || i === pts.length - 1) g += `<text class="${p.k === 0 ? 'today' : ''}" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${p.k === 0 ? 'today' : fmtDay(p.d, { month: 'short', day: 'numeric' })}</text>`; });
        g += pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${TOP}" width="${slot}" height="${H1}"/>`).join('');
        putSvg(wrap, `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash balance, 30 days back and 30 ahead">${g}</svg>`);
        hoverTips(wrap, tip, pts, p => {
            let h = `<div class="d">${esc(fmtDay(p.d, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${p.kind === 'actual' ? 'actual' : p.kind === 'est' ? 'estimated' : 'projected'}</div>`;
            if (p.cash !== null) h += `<div><span class="sw" style="background:${INK}"></span><span>Cash</span><b>${money(p.cash)}</b></div>`;
            if (p.plan !== null && anyPlan && Math.abs(p.plan - p.cash) > 0.5) h += `<div><span class="sw" style="background:var(--plan)"></span><span>With planned spending</span><b>${money(p.plan)}</b></div>`;
            if (p.flows) { if (p.flows.income) h += `<div><span class="sw" style="background:var(--orange)"></span><span>In</span><b>+${money(p.flows.income)}</b></div>`; const o = outOf(p.flows); if (o) h += `<div><span class="sw" style="background:#475569"></span><span>Spent</span><b>−${money(o)}</b></div>`; (p.flows.moves || []).forEach(([kind, label, amt]) => { h += `<div><span class="sw" style="background:#94a3b8"></span><span>${esc(label)} <i>${MOVE_LABEL[kind] || kind}</i></span><b>${kind === 'in' ? '+' : '−'}${money(amt)}</b></div>`; }); }
            return h;
        }, ti);
        $(cfg.legId).className = 'legend';
        $(cfg.legId).innerHTML = `<span class="item"><span class="ln" style="border-top-style:solid;border-top-color:${INK}"></span>Cash balance</span><span class="item"><span class="ln" style="border-top-color:${INK}"></span>projected</span>` + (anyPlan ? '<span class="item"><span class="ln"></span>with planned spending</span>' : '') + '<span class="item"><span class="sw tick"></span>card payment</span><span class="item"><span class="sw" style="background:var(--band)"></span>the 30 days above</span>';
        drawMonthEnd();
    }
    function drawMonthEnd() {
        const box = $('monthend');
        const debtNow = M.empty ? null : (isFull(S.entries[TODAY]) ? S.entries[TODAY].debt : simAt(M.plain, M.base, TODAY) ? simAt(M.plain, M.base, TODAY).debt : M.base.state.debt);
        if (debtNow === null || debtNow === undefined) { box.innerHTML = `<div class="me-head">Enter cash, savings and debt for a day and each month's check appears here.</div>`; return; }
        const total = Math.max(1, diff(TODAY, yearEnd));
        const months = [];
        for (let m = TODAY.slice(0, 7); m <= yearEnd.slice(0, 7); m = add(m + '-01', 32).slice(0, 7)) {
            const first = m + '-01', from = add(first > TODAY ? first : TODAY, first > TODAY ? 0 : 1), to = m + '-' + pad(dim(first));
            if (from > to) continue;
            let inc = 0, out = 0, days = 0;
            for (let d = from; d <= to && d <= yearEnd; d = add(d, 1)) { const f = flowsFor(d); inc += f.income; out += outOf(f); days++; }
            const surplus = inc - out, need = debtNow * days / total, extra = Math.max(0, need - surplus);
            months.push({ to, inc, out, surplus, need, extra });
        }
        const sum = months.reduce((t, x) => t + x.extra, 0);
        const per = months.length ? sum / (total / 30.4) : 0;
        box.innerHTML = `<div class="me-head">${debtNow <= 0 ? 'No debt entered, so nothing to clear.' : sum <= 0.5 ? 'On track: each month leaves enough to clear the debt by Dec 31.' : `To be debt-free by Dec 31 you need about <b>+${money(per)} more income a month</b> (${money(sum)} over the next ${months.length} month-ends).`}</div>`
            + `<div class="me-grid">` + months.map(x => `<div class="me" title="From today to ${esc(fmtDay(x.to, { month: 'long', day: 'numeric' }))}: income ${money(x.inc)}, going out ${money(x.out)}. The debt has to fall by about ${money(x.need)} in that stretch to reach zero by Dec 31.">
                <div class="k">${esc(fmtDay(x.to, { month: 'short', day: 'numeric' }))}</div>
                <div class="row"><span>In</span><b>${money(x.inc)}</b></div><div class="row"><span>Out</span><b>${money(x.out)}</b></div>
                <div class="row"><span>Left</span><b>${money(x.surplus)}</b></div>
                <div class="need ${x.extra > 0.5 ? 'short' : 'ok'}">${x.extra > 0.5 ? `needs +${money(x.extra)}` : 'on track'}</div></div>`).join('') + `</div>`;
    }
    function refresh(refill) {
        M = model();
        if (refill !== false) fillEntry(); else if (!root.activeElement || !root.activeElement.closest || !root.activeElement.closest('#entry')) fillEntry();
        drawBoxes(); drawStats(); drawCash(); drawEffect(); drawTips(); drawNeeds(); drawCatRow(); drawLadder();
    }
    $('entry').addEventListener('input', e => { if (e.target.matches('input[data-f]')) onType(); });
    $('entry').addEventListener('focusout', e => { if (e.target.matches('input[data-f]')) { clearTimeout(saveTimer); commitEntry(); } });
    $('entry').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[data-f]')) { e.preventDefault(); const all = [...root.querySelectorAll('#entry input[data-f]')]; const nx = all[all.indexOf(e.target) + 1]; if (nx) nx.focus(); else e.target.blur(); } });
    $('prev').addEventListener('click', () => { selDay = add(selDay, -1); fillEntry(); drawBoxes(); });
    $('next').addEventListener('click', () => { if (selDay < TODAY) { selDay = add(selDay, 1); fillEntry(); drawBoxes(); } });
    $('boxes').addEventListener('click', e => { const b = e.target.closest('.b'); if (b) { selDay = b.dataset.d; fillEntry(); drawBoxes(); root.querySelector('#entry input[data-f]').focus(); } });
    const drop = $('drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) takeFiles(e.dataTransfer.files); });
    drop.addEventListener('click', () => $('pick').click());
    $('pick').addEventListener('change', e => { if (e.target.files.length) takeFiles(e.target.files); e.target.value = ''; });

    // First load, then a quiet re-read when you come back to the tab. Never while
    // you are typing here.
    async function load(first) {
        try {
            const d = await call('');
            if (!first && (root.activeElement || planTimer)) return;
            take(d);
            try { S.history = await call('/history?days=' + (HIST_BACK + 1)); } catch (e) { S.history = null; }
            if (first) selDay = TODAY;
            drawFiles(); drawPlans(); drawAssume(); refresh(first);
        } catch (e) {
            if (first) { host.hidden = false; fin.innerHTML = '<div class="empty">Could not open finance: ' + esc(e.message) + '</div>'; }
        }
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(false); });
    host.hidden = true;
    load(true).then(() => { host.hidden = false; });
})();
