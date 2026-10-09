// The finance pane on the dashboard (2026-10-09): four balances a day, a
// projection of cash + savings - debt (30 days back and ahead, then weekly for
// a year), planned spending drawn as a second line, one tip-or-alert row that
// Tom writes, and a drop zone for statements. The page projects; the server
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
#fin { --orange: #eb6834; --blue: #0284c7; --violet: #4a3aa7; --pink: #c2417a; --red: #ef4444; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #0f172a; }
#fin.dark { --orange: #ea580c; --violet: #9085e9; --pink: #f472b6; --red: #f87171; color: #e2e8f0; }
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
.chart-wrap { position: relative; }
svg.chart { width: 100%; height: auto; display: block; }
svg.chart text { font-size: 10px; fill: #94a3b8; font-family: inherit; }
svg.chart text.today { fill: #0284c7; font-weight: 600; }
svg.chart .grid { stroke: #f1f5f9; stroke-width: 1; }
svg.chart .zero { stroke: #cbd5e1; stroke-width: 1; }
svg.chart .hit { fill: transparent; }
.tipbox {
        position: absolute; pointer-events: none; opacity: 0; transition: opacity 0.1s; z-index: 5;
        background: #0f172a; color: #f1f5f9; border-radius: 8px; padding: 7px 10px; font-size: 11.5px; line-height: 1.5; white-space: nowrap;
    }
.tipbox.on { opacity: 1; }
.tipbox .d { color: #cbd5e1; margin-bottom: 2px; }
.tipbox .sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #f1f5f9; font-size: 11.5px; color: #475569; }
.legend .item { display: flex; align-items: center; gap: 6px; }
.legend .sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.legend .sw.proj { background: transparent; border: 1.5px solid; }
.legend .ln { width: 14px; height: 0; border-top: 2px dashed var(--violet); }
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
#fin.dark .tipbox { background: #020617; border: 1px solid #334155; }
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

            <div class="sub">The last 30 days <span class="r" id="boxCount"></span></div>
            <div class="boxes" id="boxes"></div>

            <div class="tiprow" id="tips"></div>

            <div class="stats" id="stats"></div>

            <div class="sub">Cash <span class="r">30 days back, 30 ahead · what comes in, what goes out</span></div>
            <div class="chart-wrap" id="c1wrap"><div class="tipbox" id="tip1"></div></div>
            <div class="legend" id="leg1"></div>
            <div class="monthend" id="monthend"></div>

            <div class="sub">Next 12 months <span class="r">week by week, cash + savings − debt</span></div>
            <div class="chart-wrap" id="c2wrap"><div class="tipbox" id="tip2"></div></div>
            <div class="legend" id="leg2"></div>

            <div class="sub">What if I spend…</div>
            <div class="plans" id="plans"></div>
            <div class="effect" id="effect"></div>

            <details>
                <summary>Goals, assumptions and bills</summary>
                <div class="goals" id="goals"></div>
                <div class="incomes" id="incomes"></div>
                <div class="assume" id="assume"></div>
                <div class="bills" id="bills"></div>
                <div class="note">The projection starts from your last day with cash, savings and debt entered and walks forward: pay on the 1st and 15th, your daily spend, these bills on their days, interest on debt and savings, and the monthly moves into savings and the house fund. Leave a setting at 0 and it counts for nothing.</div>
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
    const DEFAULT_ASSUME = { income: 0, spend: 0, debtApr: 0, saveAdd: 0, houseAdd: 0, houseGoal: 0, house: 0, saveApy: 0, hysaApy: 0, investReturn: 0 };
    let S = { entries: {}, assume: Object.assign({}, DEFAULT_ASSUME), bills: [], planned: [], goals: [], incomes: [], statements: [], tip: null, nextId: 1 };
    function take(d) {
        TODAY = d.today; yearEnd = `${TODAY.slice(0, 4)}-12-31`;
        S.entries = d.entries || {};
        S.assume = Object.assign({}, DEFAULT_ASSUME, (d.plan || {}).assume);
        S.bills = ((d.plan || {}).bills || []).map(b => Object.assign({}, b));
        S.planned = ((d.plan || {}).planned || []).map(p => Object.assign({}, p));
        S.goals = ((d.plan || {}).goals || []).map(g => Object.assign({}, g));
        S.incomes = ((d.plan || {}).incomes || []).map(g => Object.assign({}, g));
        S.nextId = S.planned.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
        S.statements = d.statements || [];
        S.tip = d.tip || null;
    }
    const say = (t, bad) => { const el = $('state'); el.textContent = t; el.className = 'state ' + (bad ? 'err' : 'saved'); if (!bad) setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, 1600); };
    let planTimer = null;
    const persist = () => {
        clearTimeout(planTimer);
        planTimer = setTimeout(async () => {
            try { await call('/plan', { method: 'PUT', body: { assume: S.assume, bills: S.bills, planned: S.planned, goals: S.goals, incomes: S.incomes } }); }
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
    function stepDay(st, d, A, bills, spendCut, planned, incomes) {
        incomes = incomes || [];
        const o = { cash: st.cash, savings: st.savings, debt: st.debt, invest: st.invest, house: st.house };
        const day = dom(d), last = dim(d);
        if (A.income && (day === 1 || day === 15)) o.cash += A.income / 2;
        for (const inc of incomes) if (incomeHits(inc, d, day, last)) o.cash += inc.amount;
        o.cash -= Math.max(0, A.spend - spendCut);
        for (const b of bills) {
            if (Math.min(b.day, last) !== day) continue;
            if (b.off || (b.from && d < b.from) || (b.until && d > b.until)) continue;   // switched off, or a payment plan that has ended
            if (b.debt) { const pay = Math.min(b.amount, o.debt); o.cash -= pay; o.debt -= pay; }
            else o.cash -= b.amount;
        }
        for (const p of planned) {
            if (!p.on || !p.amount) continue;
            const hit = p.date === d || (p.monthly && d > p.date && Math.min(dom(p.date), last) === day);
            if (hit) o.cash -= p.amount;
        }
        if (day === 1) { const mv = A.saveAdd + A.houseAdd; o.cash -= mv; o.savings += mv; o.house += A.houseAdd; }
        o.debt += o.debt * (A.debtApr / 100) / 365;
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
        return { date: d, state: { cash: e.cash, savings: e.savings, debt: e.debt, invest: e.invest || 0, house: S.assume.house } };
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

    // net for each of the 61 days
    // Fixed expenses so far from today: the recurring bills that are not a debt payment, summed day by day.
    const hasExpenses = () => S.bills.some(b => !b.debt && !b.off && b.amount > 0);
    function expenseTotals(days) {
        const out = {}; let run = 0;
        for (let i = 1; i <= days; i++) {
            const d = add(TODAY, i), last = dim(d);
            for (const b of S.bills) if (!b.debt && !b.off && Math.min(b.day, last) === dom(d) && !(b.from && d < b.from) && !(b.until && d > b.until)) run += b.amount;
            out[d] = run;
        }
        return out;
    }
    const monthlyExpenses = () => S.bills.filter(b => !b.debt && !b.off && !(b.until && b.until < TODAY) && !(b.from && b.from > TODAY)).reduce((t, b) => t + (b.amount || 0), 0);
    function series2() {
        const inv = false;
        const out = [];
        if (M.empty) return out;
        const exps = expenseTotals(7 * 52);
        for (let w = 1; w <= 52; w++) {
            const d = add(TODAY, 7 * w);
            if (d <= M.base.date) continue;
            const a = simAt(M.plain, M.base, d), b = simAt(M.withPlan, M.base, d);
            out.push({ d, w, net: netOf(a, inv), plan: netOf(b, inv), debt: a.debt, planDebt: b.debt, house: a.house, savings: a.savings, kind: 'proj', exp: hasExpenses() ? -exps[d] : undefined });
        }
        return out;
    }

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
        $('boxCount').innerHTML = `<b style="color:#0284c7">${on}</b> of 30 days`;
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
        const house = (simAt(M.plain, M.base, TODAY) || { house: A.house }).house;
        $('stats').innerHTML = `
            <div class="stat"><div class="k"><span class="sw" style="background:${net >= 0 ? 'var(--orange)' : 'var(--blue)'}"></span>Net</div><div class="v">${money(net)}</div></div>
            <div class="stat"><div class="k">Debt-free</div><div class="v">${free ? esc(fmtDay(free, { month: 'short', day: 'numeric' })) : '—'}</div></div>
            <div class="stat"><div class="k">Debt left</div><div class="v">${money(t.debt)}</div></div>
            <div class="stat"><div class="k">Savings</div><div class="v">${money(t.savings)}</div></div>
            <div class="stat"><div class="k">House fund</div><div class="v">${money(house)}</div><div class="bar"><i style="width:${A.houseGoal ? Math.min(100, house / A.houseGoal * 100) : 0}%"></i></div></div>`;
    }

    // ---------- charts ----------
    const NS = 'http://www.w3.org/2000/svg';
    function niceTicks(lo, hi, n) {
        const span = (hi - lo) || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
        const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) out.push(Math.round(v * 100) / 100);
        return out;
    }
    function chart(wrapId, tipId, w, h, pts, o) {
        const wrap = $(wrapId), tip = $(tipId);
        const L = 40, R = 8, T = 14, B = 22;
        const vals = [0]; pts.forEach(p => { vals.push(p.net); if (p.plan !== null && p.plan !== undefined) vals.push(p.plan); if (o.showExp && p.exp !== undefined) vals.push(p.exp); });
        let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        const padv = (hi - lo) * 0.08 || 100; if (lo < 0) lo -= padv; hi += padv;
        const ticks = niceTicks(lo, hi, 4);
        lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
        if (o.line) { const m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; ticks.length = 0; niceTicks(-m, m, 4).forEach(v => ticks.push(v)); if (ticks.indexOf(0) < 0) ticks.push(0); }
        const y = v => T + (h - T - B) * (1 - (v - lo) / (hi - lo));
        const slot = (w - L - R) / pts.length, bw = Math.max(2, slot * (o.bar || 0.72));
        const x = i => L + slot * i + (slot - bw) / 2;
        let g = '';
        ticks.forEach(v => { g += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${money(v, true)}</text>`; });
        if (o.line) {
            // A line through the net, zero in the middle: orange above it, blue below, a faint wash back to the zero line.
            const cx = i => L + slot * i + slot / 2, y0 = y(0);
            const colOf = v => v >= 0 ? 'var(--orange)' : 'var(--blue)';
            const segs = [];
            for (let i = 0; i < pts.length - 1; i++) {
                const a = { x: cx(i), v: pts[i].net }, b = { x: cx(i + 1), v: pts[i + 1].net };
                const kind = (pts[i].kind === 'proj' || pts[i + 1].kind === 'proj') ? 'proj' : (pts[i].kind === 'est' || pts[i + 1].kind === 'est') ? 'est' : 'actual';
                if ((a.v >= 0) !== (b.v >= 0)) { const t = a.v / (a.v - b.v), m = { x: a.x + (b.x - a.x) * t, v: 0 }; segs.push([a, m, kind], [m, b, kind]); }
                else segs.push([a, b, kind]);
            }
            segs.forEach(([a, b, kind]) => { g += `<polygon points="${a.x},${y(a.v)} ${b.x},${y(b.v)} ${b.x},${y0} ${a.x},${y0}" fill="${colOf(a.v || b.v)}" fill-opacity="${kind === 'proj' ? 0.08 : 0.16}"/>`; });
            let run = null;
            const flush = () => { if (run) g += `<polyline fill="none" stroke="${run.c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${run.kind === 'proj' ? ' stroke-dasharray="5 3"' : ''}${run.kind === 'est' ? ' stroke-opacity="0.55"' : ''} points="${run.pts.join(' ')}"/>`; run = null; };
            segs.forEach(([a, b, kind]) => {
                const c = colOf(a.v || b.v);
                if (!run || run.c !== c || run.kind !== kind) { flush(); run = { c, kind, pts: [`${a.x},${y(a.v)}`] }; }
                run.pts.push(`${b.x},${y(b.v)}`);
            });
            flush();
            pts.forEach((p, i) => { if (p.kind === 'actual') g += `<circle cx="${cx(i)}" cy="${y(p.net)}" r="2.3" fill="${colOf(p.net)}"/>`; });
            const ti = pts.findIndex(p => p.k === 0);
            if (ti >= 0) g += `<line x1="${cx(ti)}" x2="${cx(ti)}" y1="${T}" y2="${h - B}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 3"/>`;
        }
        if (!o.line) pts.forEach((p, i) => {
            const pos = p.net >= 0, col = pos ? 'var(--orange)' : 'var(--blue)';
            const top = Math.min(y(p.net), y(0)), ht = Math.max(1, Math.abs(y(p.net) - y(0)));
            if (p.kind === 'proj') g += `<rect x="${x(i)}" y="${top}" width="${bw}" height="${ht}" rx="1.5" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="1" stroke-dasharray="3 2"/>`;
            else g += `<rect x="${x(i)}" y="${top}" width="${bw}" height="${ht}" rx="1.5" fill="${col}" fill-opacity="${p.kind === 'est' ? 0.5 : 1}"/>`;
        });
        if (o.showExp) {
            const ep = pts.map((p, i) => ({ i, v: p.exp })).filter(q => q.v !== undefined);
            if (ep.length > 1) g += `<polyline fill="none" stroke="var(--pink)" stroke-width="1.8" stroke-linejoin="round" points="${ep.map(q => `${x(q.i) + bw / 2},${y(q.v)}`).join(' ')}"/>`;
        }
        const planPts = pts.map((p, i) => ({ i, v: p.plan })).filter(q => q.v !== null && q.v !== undefined);
        if (o.showPlan && planPts.length > 1) g += `<polyline fill="none" stroke="var(--violet)" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round" points="${planPts.map(q => `${x(q.i) + bw / 2},${y(q.v)}`).join(' ')}"/>`;
        (o.marks || []).forEach(m => { g += `<line x1="${m.x}" x2="${m.x}" y1="${T - 4}" y2="${h - B}" stroke="${m.color}" stroke-width="1" stroke-dasharray="2 3"/><text x="${m.x}" y="${T - 5}" text-anchor="middle" style="fill:${m.color}">${m.label}</text>`; });
        pts.forEach((p, i) => { if (o.labelAt(i, p)) g += `<text class="${p.k === 0 ? 'today' : ''}" x="${x(i) + bw / 2}" y="${h - 7}" text-anchor="middle">${o.label(p)}</text>`; });
        g += pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${h - T - B}"/>`).join('');
        wrap.querySelector('svg') && wrap.querySelector('svg').remove();
        wrap.insertAdjacentHTML('afterbegin', `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.aria)}">${g}</svg>`);
        wrap.querySelectorAll('.hit').forEach(el => {
            el.addEventListener('mouseenter', () => {
                const p = pts[+el.dataset.i];
                tip.innerHTML = o.tip(p); tip.classList.add('on');
                const wr = wrap.getBoundingClientRect(), er = el.getBoundingClientRect();
                const left = er.left - wr.left + er.width / 2;
                tip.style.left = Math.max(0, Math.min(wr.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
                tip.style.top = '4px';
            });
            el.addEventListener('mouseleave', () => tip.classList.remove('on'));
        });
    }
    function draw2() {
        if (M.empty) { showEmpty('c2wrap', ''); $('leg2').innerHTML = ''; return; }
        clearEmpty('c2wrap');
        const pts = series2();
        if (!pts.length) { $('leg2').innerHTML = ''; return; }
        const anyPlan = S.planned.some(p => p.on && p.amount);
        const freeIdx = pts.findIndex(p => p.debt <= 0.5);
        const L = 40, R = 8, w = 600, slot = (w - L - R) / pts.length;
        const marks = freeIdx >= 0 ? [{ x: L + slot * freeIdx + slot / 2, color: 'var(--blue)', label: 'debt-free' }] : [];
        chart('c2wrap', 'tip2', w, 190, pts, {
            aria: 'Projected net position, week by week for the next 12 months', showPlan: anyPlan, showExp: hasExpenses(), bar: 0.74, line: true, marks,
            labelAt: (i, p) => i === 0 || p.d.slice(5, 7) !== pts[i - 1].d.slice(5, 7),
            label: p => fmtDay(p.d, { month: 'short' }),
            tip: p => `<div class="d">Week of ${esc(fmtDay(p.d, { month: 'short', day: 'numeric' }))} · projected</div>`
                + `<div><span class="sw" style="background:${p.net >= 0 ? 'var(--orange)' : 'var(--blue)'}"></span>Net <b>${money(p.net)}</b></div>`
                + `<div>Debt ${money(p.debt)} · Savings ${money(p.savings)}</div><div>House fund ${money(p.house)}</div>`
                + (p.exp !== undefined ? `<div><span class="sw" style="background:var(--pink)"></span>Fixed expenses since today <b>${money(-p.exp)}</b></div>` : '')
                + (anyPlan ? `<div><span class="sw" style="background:var(--violet)"></span>With planned spending <b>${money(p.plan)}</b> (debt ${money(p.planDebt)})</div>` : '')
        });
        const decIdx = (() => { let j = -1; pts.forEach((p, i) => { if (p.d <= yearEnd) j = i; }); return j; })();
        $('leg2').innerHTML = `<span class="item"><span class="sw" style="background:var(--orange)"></span>Cash + savings ahead of debt</span>
            <span class="item"><span class="sw" style="background:var(--blue)"></span>Debt ahead</span>
            <span class="item"><span class="ln" style="border-top-color:var(--orange)"></span>Projected</span>
            ${hasExpenses() ? '<span class="item"><span class="ln" style="border-top-style:solid;border-top-color:var(--pink)"></span>Fixed expenses since today</span>' : ''}
            ${anyPlan ? '<span class="item"><span class="ln"></span>With planned spending</span>' : ''}
            <span class="item">${freeIdx >= 0 ? `Debt reaches zero the week of <b style="margin-left:3px">${esc(fmtDay(pts[freeIdx].d, { month: 'short', day: 'numeric' }))}</b>` : 'Debt is not cleared within 12 months'}</span>
            <span class="item">House fund by Dec 31 <b style="margin-left:3px">${money(pts[decIdx >= 0 ? decIdx : pts.length - 1].house)}</b></span>`;
    }

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
        if (M.empty || !on.length) { $('effect').textContent = on.length ? '' : 'Tick one on, or add something you are thinking of buying, and the violet line shows what it does to the next 60 days and the next 12 months.'; return; }
        const total = on.reduce((s, p) => s + p.amount * (p.monthly ? 1 : 1), 0);
        const d = yearEnd > M.base.date ? simAt(M.plain, M.base, yearEnd) : null, dp = d ? simAt(M.withPlan, M.base, yearEnd) : null;
        const shift = M.freeDate && M.freePlanDate ? diff(M.freeDate, M.freePlanDate) : null;
        $('effect').innerHTML = `With ${on.length === 1 ? 'this' : 'these ' + on.length}: <b>${d ? money(netOf(dp) - netOf(d)) : '—'}</b> on your net by Dec 31`
            + (shift !== null ? `, and the debt-free date ${shift === 0 ? 'does not move' : shift > 0 ? `moves <b>${shift} day${shift === 1 ? '' : 's'} later</b> (${esc(fmtDay(M.freePlanDate, { month: 'short', day: 'numeric', year: 'numeric' }))})` : 'moves earlier'}` : '')
            + '.';
    }

    const AS = [['spend', 'Everyday spending a day', '$'], ['debtApr', 'Debt APR', '%'], ['saveAdd', 'To savings, the 1st', '$'],
                ['houseAdd', 'To house fund, the 1st', '$'], ['houseGoal', 'House fund goal', '$'], ['house', 'House fund now (inside savings)', '$'],
                ['saveApy', 'Your savings rate', '%'], ['hysaApy', 'A better savings rate', '%'], ['investReturn', 'Trading account return', '%']];
    function drawAssume() {
        $('assume').innerHTML = AS.map(([k, label]) => `<label>${label}<input type="text" inputmode="decimal" data-a="${k}" value="${S.assume[k] || ''}" placeholder="0"></label>`).join('');
        $('assume').querySelectorAll('input').forEach(el => el.addEventListener('input', () => {
            const v = el.value.trim() === '' ? 0 : parseMoney(el.value); if (v === null) return;
            S.assume[el.dataset.a] = v; persist(); refresh(false);
        }));
        drawGoals();
        drawIncomes();
        drawBills();
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
        $('files').innerHTML = S.statements.map(f => `<span>📄 ${esc(f.name)} <a data-id="${f.id}" title="Remove">×</a></span>`).join('');
        $('drop').classList.toggle('has', S.statements.length > 0);
        $('drop').textContent = S.statements.length ? S.statements.length : '+';
        $('files').querySelectorAll('a').forEach(a => a.addEventListener('click', async () => {
            if (!confirm('Remove this statement?')) return;
            try { await fetch('/api/finance/statements/' + a.dataset.id, { method: 'DELETE' }); S.statements = S.statements.filter(f => f.id !== +a.dataset.id); drawFiles(); }
            catch (e) { say('not removed', true); }
        }));
    }
    async function takeFiles(list) {
        for (const f of [...list]) {
            say('uploading…');
            try {
                const res = await fetch(base + '/statements', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' }, body: f });
                const out = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(out.error || ('HTTP ' + res.status));
                S.statements.unshift(out); drawFiles(); say('saved');
            } catch (e) { say(e.message || 'not uploaded', true); }
        }
    }

    // ---------- glue ----------
    function showEmpty(id, msg) {
        const w = $(id); const old = w.querySelector('svg'); if (old) old.remove();
        let e = w.querySelector('.empty'); if (!e) { e = document.createElement('div'); e.className = 'empty'; w.insertBefore(e, w.firstChild); }
        e.textContent = msg; e.hidden = !msg;
    }
    const clearEmpty = id => { const e = $(id).querySelector('.empty'); if (e) e.remove(); };

    // ---------- cash: what comes in, what goes out ----------
    // Top: the cash balance (entered days, then the projection). Bottom: each day's flows, income up in orange,
    // what goes out stacked downward by kind. The month-end check under it says what extra income each month
    // would need for the debt to be gone by Dec 31.
    const FLOW = { income: ['Income', 'var(--orange)'], bill: ['Fixed bills', 'var(--pink)'], plan: ['Payment plans and cards', 'var(--blue)'], planned: ['Planned spending', 'var(--violet)'], daily: ['Everyday spending', '#eda100'] };
    function flowsFor(d) {
        const day = dom(d), last = dim(d), f = { income: 0, bill: 0, plan: 0, planned: 0, daily: 0, items: [] };
        const A = S.assume;
        if (A.income && (day === 1 || day === 15)) { f.income += A.income / 2; f.items.push(['income', 'Pay', A.income / 2]); }
        for (const inc of S.incomes) if (incomeHits(inc, d, day, last)) { f.income += inc.amount; f.items.push(['income', inc.label || 'Income', inc.amount]); }
        for (const b of S.bills) {
            if (b.off || Math.min(b.day, last) !== day || (b.from && d < b.from) || (b.until && d > b.until)) continue;
            const kind = b.debt || b.until ? 'plan' : 'bill';
            f[kind] += b.amount; f.items.push([kind, b.label, b.amount]);
        }
        for (const p of S.planned) {
            if (!p.on || !p.amount) continue;
            if (p.date === d || (p.monthly && d > p.date && Math.min(dom(p.date), last) === day)) { f.planned += p.amount; f.items.push(['planned', p.label, p.amount]); }
        }
        f.daily = A.spend || 0;
        return f;
    }
    function cashSeries() {
        const out = [];
        const days = Object.keys(S.entries).filter(d => typeof S.entries[d].cash === 'number').sort();
        for (let k = -30; k <= 30; k++) {
            const d = add(TODAY, k);
            let cash = null, kind = 'est', plan = null, flows = null;
            if (!M.empty && d > M.base.date) { const r = simAt(M.plain, M.base, d); cash = r.cash; kind = k <= 0 ? 'est' : 'proj'; if (k >= 0) plan = simAt(M.withPlan, M.base, d).cash; }
            else if (typeof (S.entries[d] || {}).cash === 'number') { cash = S.entries[d].cash; kind = 'actual'; }
            else {
                const before = [...days].reverse().find(x => x < d), after = days.find(x => x > d);
                if (before && after) cash = S.entries[before].cash + (S.entries[after].cash - S.entries[before].cash) * diff(before, d) / diff(before, after);
                else if (before || after) cash = S.entries[before || after].cash;
            }
            if (k > 0) flows = flowsFor(d);
            out.push({ d, k, cash, kind, plan, flows });
        }
        return out;
    }
    function drawCash() {
        const wrap = $('c1wrap'), tip = $('tip1');
        if (M.empty && !Object.keys(S.entries).some(d => typeof S.entries[d].cash === 'number')) { showEmpty('c1wrap', 'Enter your cash for a day and the cash picture appears.'); $('leg1').innerHTML = ''; return; }
        clearEmpty('c1wrap');
        const pts = cashSeries();
        const anyPlan = S.planned.some(p => p.on && p.amount) && !M.empty;
        const W = 600, L = 40, R = 8, slot = (W - L - R) / pts.length, cx = i => L + slot * i + slot / 2;
        const TOP = 12, H1 = 118, GAP = 14, H2 = 96, LAB = 20, H = TOP + H1 + GAP + H2 + LAB;
        // cash panel
        const cv = pts.map(p => p.cash).filter(v => v !== null).concat(pts.map(p => p.plan).filter(v => v !== null), [0]);
        let lo = Math.min.apply(null, cv), hi = Math.max.apply(null, cv); const pad = (hi - lo) * 0.08 || 100; hi += pad; if (lo < 0) lo -= pad; else lo = 0;
        const t1 = niceTicks(lo, hi, 3); lo = Math.min(lo, t1[0]); hi = Math.max(hi, t1[t1.length - 1]);
        const y1 = v => TOP + H1 * (1 - (v - lo) / (hi - lo));
        // flow panel
        const fl = pts.filter(p => p.flows);
        const maxIn = Math.max(1, ...fl.map(p => p.flows.income)), maxOut = Math.max(1, ...fl.map(p => p.flows.bill + p.flows.plan + p.flows.planned + p.flows.daily));
        const y2base = TOP + H1 + GAP, ztop = maxIn / (maxIn + maxOut), y0 = y2base + H2 * ztop, unit = H2 / (maxIn + maxOut);
        let g = '';
        t1.forEach(v => { g += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y1(v)}" y2="${y1(v)}"/><text x="${L - 5}" y="${y1(v) + 3}" text-anchor="end">${money(v, true)}</text>`; });
        g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}"/><text x="${L - 5}" y="${y0 + 3}" text-anchor="end">in / out</text>`;
        // the cash line, orange above zero and blue below, dashed where projected
        const colOf = v => v >= 0 ? 'var(--orange)' : 'var(--blue)';
        let run = null;
        const flush = () => { if (run) g += `<polyline fill="none" stroke="${run.c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${run.kind === 'proj' ? ' stroke-dasharray="5 3"' : ''}${run.kind === 'est' ? ' stroke-opacity="0.55"' : ''} points="${run.pts.join(' ')}"/>`; run = null; };
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1]; if (a.cash === null || b.cash === null) { flush(); continue; }
            const kind = (a.kind === 'proj' || b.kind === 'proj') ? 'proj' : (a.kind === 'est' || b.kind === 'est') ? 'est' : 'actual';
            const parts = (a.cash >= 0) !== (b.cash >= 0) ? (() => { const t = a.cash / (a.cash - b.cash); return [[a.cash, 0, cx(i), cx(i) + (cx(i + 1) - cx(i)) * t], [0, b.cash, cx(i) + (cx(i + 1) - cx(i)) * t, cx(i + 1)]]; })() : [[a.cash, b.cash, cx(i), cx(i + 1)]];
            parts.forEach(([v0, v1, x0, x1]) => { const c = colOf(v0 || v1); if (!run || run.c !== c || run.kind !== kind) { flush(); run = { c, kind, pts: [`${x0},${y1(v0)}`] }; } run.pts.push(`${x1},${y1(v1)}`); });
        }
        flush();
        pts.forEach((p, i) => { if (p.kind === 'actual') g += `<circle cx="${cx(i)}" cy="${y1(p.cash)}" r="2.3" fill="${colOf(p.cash)}"/>`; });
        const pp = pts.map((p, i) => ({ i, v: p.plan })).filter(q => q.v !== null);
        if (anyPlan && pp.length > 1) g += `<polyline fill="none" stroke="var(--violet)" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round" points="${pp.map(q => `${cx(q.i)},${y1(q.v)}`).join(' ')}"/>`;
        // the flows
        const bw = Math.max(2, slot * 0.7);
        pts.forEach((p, i) => {
            if (!p.flows) return;
            const f = p.flows; let up = 0, down = 0;
            const bar = (v, col, dirUp) => { if (v <= 0) return; const h = Math.max(1, v * unit); const yy = dirUp ? y0 - up - h : y0 + down; g += `<rect x="${cx(i) - bw / 2}" y="${yy}" width="${bw}" height="${h}" fill="${col}" fill-opacity="0.9"/>`; if (dirUp) up += h; else down += h; };
            bar(f.income, FLOW.income[1], true);
            ['daily', 'bill', 'plan', 'planned'].forEach(kd => bar(f[kd], FLOW[kd][1], false));
        });
        g += `<text x="${L + 6}" y="${y0 + 4}" style="font-style:italic">Past money in and out will show here once your statements are read.</text>`;
        const ti = pts.findIndex(p => p.k === 0);
        g += `<line x1="${cx(ti)}" x2="${cx(ti)}" y1="${TOP}" y2="${y2base + H2}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 3"/>`;
        pts.forEach((p, i) => { if (i % 10 === 0 || i === 30) g += `<text class="${p.k === 0 ? 'today' : ''}" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${p.k === 0 ? 'today' : fmtDay(p.d, { month: 'short', day: 'numeric' })}</text>`; });
        g += pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${TOP}" width="${slot}" height="${H - TOP - LAB}"/>`).join('');
        const old = wrap.querySelector('svg'); if (old) old.remove();
        wrap.insertAdjacentHTML('afterbegin', `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash balance and daily money in and out, 30 days back and 30 ahead">${g}</svg>`);
        wrap.querySelectorAll('.hit').forEach(el => {
            el.addEventListener('mouseenter', () => {
                const p = pts[+el.dataset.i], f = p.flows;
                let h = `<div class="d">${esc(fmtDay(p.d, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${p.kind === 'actual' ? 'entered' : p.kind === 'est' ? 'estimated' : 'projected'}</div>`;
                if (p.cash !== null) h += `<div><span class="sw" style="background:${colOf(p.cash)}"></span>Cash <b>${money(p.cash)}</b></div>`;
                if (p.plan !== null && anyPlan && Math.abs(p.plan - p.cash) > 0.5) h += `<div><span class="sw" style="background:var(--violet)"></span>With planned spending <b>${money(p.plan)}</b></div>`;
                if (f) { f.items.forEach(([kd, label, amt]) => { h += `<div><span class="sw" style="background:${FLOW[kd][1]}"></span>${esc(label)} <b>${kd === 'income' ? '+' : '−'}${money(amt)}</b></div>`; }); if (f.daily) h += `<div><span class="sw" style="background:${FLOW.daily[1]}"></span>Everyday <b>−${money(f.daily)}</b></div>`; }
                tip.innerHTML = h; tip.classList.add('on');
                const wr = wrap.getBoundingClientRect(), er = el.getBoundingClientRect(), left = er.left - wr.left + er.width / 2;
                tip.style.left = Math.max(0, Math.min(wr.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px'; tip.style.top = '4px';
            });
            el.addEventListener('mouseleave', () => tip.classList.remove('on'));
        });
        $('leg1').innerHTML = Object.keys(FLOW).map(k => `<span class="item"><span class="sw" style="background:${FLOW[k][1]}"></span>${FLOW[k][0]}</span>`).join('')
            + `<span class="item"><span class="ln" style="border-top-style:solid;border-top-color:var(--orange)"></span>Cash balance</span>`
            + (anyPlan ? '<span class="item"><span class="ln"></span>Cash with planned spending</span>' : '');
        drawMonthEnd();
    }
    // At each month's end: what came in, what went out, and the extra income that month would need so the debt
    // reaches zero by Dec 31 on a straight line from today. Cash on hand and savings are left out on purpose.
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
            for (let d = from; d <= to && d <= yearEnd; d = add(d, 1)) { const f = flowsFor(d); inc += f.income; out += f.bill + f.plan + f.planned + f.daily; days++; }
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
        drawBoxes(); drawStats(); drawCash(); draw2(); drawEffect(); drawTips();
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
