// The Sunday report card (2026-10-10): one component for both panes, used by the dashboard's REPORT pane
// (Sundays only, Kevin 2026-10-10: "otherwise it clutters up the place") and the /report history page.
// A one-row summary (chip, the week, the pane's letter, each line's letter, the last eight weeks) that
// opens to the lines with their numbers, the targets, Tom's note and how it is graded.
const REPORT_CSS = `
.rc { margin: 10px 0 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font-size: 12.5px; line-height: 1.45; color: #0f172a; }
.rc summary { list-style: none; display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; min-height: 42px; flex-wrap: wrap; }
.rc summary::-webkit-details-marker { display: none; }
.rc .chip { flex-shrink: 0; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; border-radius: 4px; padding: 1px 6px; color: #0284c7; background: #e0f2fe; }
.rc .wk { color: #64748b; }
.rc .g { display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-variant-numeric: tabular-nums; color: #fff; background: #64748b; }
.rc .big { width: 30px; height: 30px; border-radius: 8px; font-size: 17px; }
.rc .gA, .rc .gB { background: #0284c7; } .rc .gC { background: #64748b; } .rc .gD { background: #b45309; } .rc .gF { background: #ef4444; } .rc .gI { background: transparent; color: #94a3b8; border: 1px dashed #cbd5e1; }
.rc .mini { display: flex; gap: 10px; flex-wrap: wrap; color: #475569; }
.rc .mini i { font-style: normal; display: inline-flex; align-items: center; gap: 4px; }
.rc .mini .g { width: 18px; height: 18px; border-radius: 5px; font-size: 11px; }
.rc .hist { margin-left: auto; display: flex; gap: 3px; }
.rc .hist .g { width: 14px; height: 14px; border-radius: 3px; font-size: 9px; }
.rc .hist .gI { color: #cbd5e1; border-style: dotted; }
.rc .body { border-top: 1px solid #f1f5f9; padding: 8px 10px 10px; }
.rc table { border-collapse: collapse; width: 100%; }
.rc td { padding: 4px 6px 4px 0; vertical-align: middle; border: none; }
.rc td.l .g { width: 22px; height: 22px; border-radius: 6px; font-size: 12px; }
.rc td.n { font-weight: 600; white-space: nowrap; width: 1%; padding-right: 10px; }
.rc td.t { width: 1%; white-space: nowrap; color: #64748b; font-size: 11.5px; padding-left: 10px; text-align: right; }
.rc td.t input { width: 62px; font: inherit; font-size: 11.5px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 2px 5px; background: #fff; color: #0f172a; text-align: right; font-variant-numeric: tabular-nums; }
.rc td.t input:focus { outline: none; border-color: #7dd3fc; box-shadow: 0 0 0 2px #e0f2fe; }
.rc td.note { color: #475569; }
.rc .tom { display: flex; gap: 10px; align-items: flex-start; margin-top: 8px; padding: 7px 9px; border-radius: 6px; background: #f8fafc; border: 1px dashed #e2e8f0; color: #334155; }
.rc .tom .who { flex-shrink: 0; font-size: 10px; font-weight: 700; letter-spacing: .05em; color: #0284c7; margin-top: 2px; }
.rc .tom.idle { color: #94a3b8; }
.rc .how { margin-top: 8px; font-size: 11px; color: #94a3b8; }
.rc .how summary { display: inline; padding: 0; min-height: 0; cursor: pointer; color: #64748b; }
.rc .how ul { margin: 4px 0 0; padding-left: 16px; color: #64748b; }
.rc .how li { margin: 1px 0; }
.rc .state { font-size: 11px; color: #94a3b8; margin-left: 8px; }
body.dark .rc, #fin.dark .rc { background: #0f172a; border-color: #334155; color: #e2e8f0; }
body.dark .rc .chip, #fin.dark .rc .chip { background: rgba(14, 165, 233, 0.18); color: #38bdf8; }
body.dark .rc .body, #fin.dark .rc .body { border-top-color: #334155; }
body.dark .rc td.note, body.dark .rc .mini, #fin.dark .rc td.note, #fin.dark .rc .mini { color: #cbd5e1; }
body.dark .rc td.t input, #fin.dark .rc td.t input { background: #1e293b; border-color: #334155; color: #e2e8f0; }
body.dark .rc .tom, #fin.dark .rc .tom { background: #1e293b; border-color: #334155; color: #e2e8f0; }
body.dark .rc .tom.idle, #fin.dark .rc .tom.idle { color: #94a3b8; }
body.dark .rc .gI, #fin.dark .rc .gI { border-color: #475569; }
`;
const REPORT_HOW = {
    health: ['Steps: the average of logged days against the target (A at or above it, B 85%, C 70%, D 55%); four logged days needed.',
        'Weight: this week\'s average against last week\'s (A down ½ lb or at the goal, B down ⅕ lb, C level, D up under 1 lb, F up 1 lb or more); two weigh-ins needed.',
        'Gym and yoga: days against the weekly target (A all of them, B two thirds, C a third, D any, F none).',
        'Logged: days with any entry (A 7, B 6, C 5, D 4). Each line counts the same; the pane\'s grade is the average.'],
    finance: ['Everyday spending: groceries, dining, shopping, entertainment and other (not bills, medical, travel, taxes or dad) against seven days of the daily budget (A at or under, B 115%, C 130%, D 150%). Needs statements that reach the end of the week.',
        'Debt: where the balance sits against a straight line from where you started to zero on Dec 31 (A on or ahead of the line, B within 5% of the starting debt, C 10%, D 20%).',
        'Savings: the week\'s move against the monthly target split by week (A all of it, B ¾, C ½, D any); with no target, up is A or B, level C, down D or F.',
        'Interest: any card interest in the week is an F (never a balance carried).',
        'Housekeeping: balances entered on three days (A), two (B), one (C), none (F); a letter off for each statement overdue and for a question of Tom\'s waiting over three days. Each line counts the same; the pane\'s grade is the average.']
};
function reportCardHtml(pane, R, esc, open) {
    const C = R[pane], g = (x, cls) => `<span class="g g${x}${cls ? ' ' + cls : ''}" title="${x === 'I' ? 'Incomplete: the data could not grade it' : 'Grade ' + x}">${x === 'I' ? '–' : x}</span>`;
    const wk = `${fmtDayLocal(R.week_start, { month: 'short', day: 'numeric' })} – ${fmtDayLocal(R.week_ending, { month: 'short', day: 'numeric' })}`;
    const target = (l) => {
        if (pane === 'health' && ['steps', 'weight', 'gym', 'yoga'].includes(l.key)) {
            const unit = l.key === 'steps' ? ' a day' : l.key === 'weight' ? ' lb' : ' a week';
            return `<input type="text" inputmode="decimal" data-target="${l.key}" value="${l.key === 'weight' ? (R.health.targets.weight || '') : R.health.targets[l.key]}" placeholder="target" title="The target this line is graded against">${unit}`;
        }
        if (l.key === 'housekeeping') return l.target != null ? l.target + ' days' : '';
        return l.target != null ? (pane === 'finance' ? '$' + Math.round(l.target).toLocaleString() : String(l.target)) : '';
    };
    return `<details class="rc" ${open ? 'open' : ''}><summary><span class="chip">${pane === 'health' ? 'HEALTH' : 'FINANCE'}</span><span class="wk">${wk}</span>${g(C.grade, 'big')}<span class="mini">${C.lines.map(l => `<i>${esc(l.label)} ${g(l.grade)}</i>`).join('')}</span><span class="hist" title="The last eight weeks">${R.history.map(h => g(h[pane])).join('')}</span></summary>
        <div class="body"><table>${C.lines.map(l => `<tr><td class="l">${g(l.grade)}</td><td class="n">${esc(l.label)}</td><td class="note">${esc(l.note)}</td><td class="t">${target(l)}</td></tr>`).join('')}</table>
        ${R.notes[pane] ? `<div class="tom"><span class="who">TOM</span><span>${esc(R.notes[pane])}</span></div>` : `<div class="tom idle"><span class="who">TOM</span><span>Tom writes his note here on Sunday morning.</span></div>`}
        <details class="how"><summary>How it is graded</summary><ul>${REPORT_HOW[pane].map(t => `<li>${esc(t)}</li>`).join('')}</ul></details><span class="state" data-rc-state></span></div></details>`;
}
const fmtDayLocal = (key, opts) => new Date(key + 'T00:00:00Z').toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC' }, opts));
window.REPORT_CSS = REPORT_CSS; window.reportCardHtml = reportCardHtml; window.fmtDayLocal = fmtDayLocal;
