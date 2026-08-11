#!/usr/bin/env node
/* Extracts every animated demo vignette out of server/public/help.html into its
   own standalone, Safari-openable file in this folder.
   help.html stays the source of truth — rerun this whenever a scene changes:
       node docs/animation/build.js
   Each card carries the FULL help stylesheet rather than a sliced subset, so an
   extracted scene is pixel-identical to the one on the help page.            */
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT  = __dirname;
const src  = fs.readFileSync(path.join(ROOT, 'server/public/help.html'), 'utf8');

const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];

/* Titles come out of the HTML with entities still encoded (&#127769; etc.) —
   decode before they become display text or, worse, part of a filename. */
const NAMED = { amp:'&', lt:'<', gt:'>', quot:'"', hellip:'…', rarr:'→',
                larr:'←', uarr:'↑', darr:'↓', nbsp:' ', mdash:'—', ndash:'–' };
const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
                     .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
                     .replace(/&(\w+);/g, (m, n) => NAMED[n] !== undefined ? NAMED[n] : m);

/* Collect <div class="card ..."> blocks by depth-counting <div>/</div>, so the
   nested scene markup inside a demo card can't fool the matcher. */
function blocks(html) {
  const out = [];
  const re = /<div class="(card[^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    let depth = 1, i = re.lastIndex;
    const tag = /<\/?div\b[^>]*>/g; tag.lastIndex = i;
    let t;
    while (depth > 0 && (t = tag.exec(html))) {
      depth += t[0].startsWith('</') ? -1 : 1;
      i = tag.lastIndex;
    }
    out.push({ cls: m[1], start: m.index, end: i, html: html.slice(m.index, i) });
    re.lastIndex = i;
  }
  return out;
}

const all = blocks(src);
const slug = s => s.toLowerCase().replace(/&\w+;/g, '').replace(/[^a-z0-9]+/g, '-')
                   .replace(/^-|-$/g, '').slice(0, 40);

/* Pair each demo card with the nearest preceding text card — that's its title. */
const scenes = [];
all.forEach((b, idx) => {
  if (!/\bdemo\b/.test(b.cls)) return;
  let title = 'scene', body = '';
  for (let j = idx - 1; j >= 0; j--) {
    if (/\bdemo\b/.test(all[j].cls)) continue;
    const h3 = all[j].html.match(/<h3>([\s\S]*?)<\/h3>/);
    const p  = all[j].html.match(/<p>([\s\S]*?)<\/p>/);
    if (h3) { title = decode(h3[1].replace(/<[^>]+>/g, '')).trim(); body = p ? p[1] : ''; }
    break;
  }
  scenes.push({ title, body, html: b.html, cls: b.cls });
});

/* Scenes sharing a title (light/dark) get a suffix so filenames stay distinct. */
const seen = {};
scenes.forEach((s, i) => {
  const base = slug(s.title) || 'scene';
  seen[base] = (seen[base] || 0) + 1;
  s.file = String(i + 1).padStart(2, '0') + '-' + base +
           (seen[base] > 1 ? '-' + seen[base] : '') + '.html';
});

const nav = scenes.map(s => `<a href="${s.file}" data-file="${s.file}">${s.title}</a>`).join('\n      ');

const SHELL_CSS = `
/* ---- extracted-scene shell (not part of help.html) ---- */
  body { padding: 0; }
  .xnav { position: sticky; top: 0; z-index: 9; display: flex; flex-wrap: wrap; gap: 4px;
          padding: 8px 12px; background: rgba(255,255,255,.92); backdrop-filter: blur(8px);
          border-bottom: 1px solid #e2e8f0; font-size: 12px; }
  .xnav a { color: #475569; text-decoration: none; padding: 3px 8px; border-radius: 6px;
            border: 1px solid #e2e8f0; white-space: nowrap; }
  .xnav a:hover { border-color: #38bdf8; color: #0284c7; background: #f0f9ff; }
  .xnav a.here { background: #f0f9ff; border-color: #38bdf8; color: #0284c7; }
  .xwrap { max-width: 900px; margin: 0 auto; padding: 28px 20px 60px; }
  .xhead { font-size: 20px; font-weight: 650; color: #0f172a; margin-bottom: 4px; }
  .xbody { font-size: 13px; color: #475569; line-height: 1.55; margin-bottom: 20px; max-width: 62ch; }
  .xstage { display: flex; justify-content: center; }
  .xstage > .card.demo { min-width: 420px; }
  .xnote { margin-top: 24px; font-size: 11.5px; color: #94a3b8; line-height: 1.6; }
  body.dark .xnav { background: rgba(15,23,42,.92); border-bottom-color: #334155; }
  body.dark .xnav a { border-color: #334155; color: #94a3b8; }
  body.dark .xhead { color: #e2e8f0; }
  body.dark .xbody { color: #94a3b8; }`;

const SHELL_JS = `
  document.querySelectorAll('.xnav a[data-file]').forEach(a => {
    if (a.dataset.file === location.pathname.split('/').pop()) a.classList.add('here');
  });
  const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now=new Date();
  document.querySelectorAll('[data-day-offset]').forEach(el=>{
    const d=new Date(now); d.setUTCDate(d.getUTCDate()+parseInt(el.dataset.dayOffset,10));
    el.textContent=dayNames[d.getUTCDay()].slice(0,3)+' \\u00b7 '+monthNames[d.getUTCMonth()]+' '+d.getUTCDate();
  });
  const a1=document.getElementById('todayDayName'), a2=document.getElementById('todayDate');
  if(a1) a1.textContent=dayNames[now.getUTCDay()];
  if(a2) a2.textContent=monthNames[now.getUTCMonth()]+' '+now.getUTCDate();
  try { if(localStorage.getItem('movealong.theme')==='dark') document.body.classList.add('dark'); } catch(e){}
  addEventListener('keydown',e=>{ if(e.key==='d'||e.key==='D') document.body.classList.toggle('dark'); });`;

const S = '<' + 'script>', ES = '<' + '/script>';

const page = s => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${s.title} — MoveAlong animation</title>
<style>
${css}
${SHELL_CSS}
</style>
</head>
<body>
  <nav class="xnav">
      <a href="index.html">&larr; all</a>
      ${nav}
  </nav>
  <div class="xwrap">
    <div class="xhead">${s.title}</div>
    <div class="xbody">${s.body.trim()}</div>
    <div class="xstage">
${s.html.split('\n').map(l => '      ' + l.trim()).join('\n')}
    </div>
    <div class="xnote">Extracted from <code>server/public/help.html</code> by
      <code>docs/animation/build.js</code> — edit the scene there, then rerun the
      build. Press <kbd>D</kbd> to toggle dark.</div>
  </div>
${S}${SHELL_JS}
${ES}
</body>
</html>
`;

fs.readdirSync(OUT).filter(f => /^\d\d-.*\.html$/.test(f))
  .forEach(f => fs.unlinkSync(path.join(OUT, f)));
scenes.forEach(s => fs.writeFileSync(path.join(OUT, s.file), page(s)));

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MoveAlong — animations</title>
<style>
${css}
  body { padding: 0; }
  .xwrap { max-width: 1100px; margin: 0 auto; padding: 36px 20px 80px; }
  h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
  .sub { font-size: 13px; color: #475569; margin-bottom: 26px; max-width: 66ch; line-height: 1.6; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .tile { display: block; text-decoration: none; border: 1px solid #e2e8f0; border-radius: 10px;
          padding: 14px 16px; background: #fff; }
  .tile:hover { border-color: #38bdf8; background: #f0f9ff; }
  .tile b { display: block; font-size: 14px; color: #0f172a; font-weight: 650; margin-bottom: 3px; }
  .tile span { font-size: 12px; color: #64748b; line-height: 1.5; }
  body.dark .tile { background:#1e293b; border-color:#334155; }
  body.dark .tile b { color:#e2e8f0; } body.dark .tile span { color:#94a3b8; }
  body.dark h1 { color:#e2e8f0; } body.dark .sub { color:#94a3b8; }
</style></head>
<body><div class="xwrap">
  <h1>MoveAlong — animated scenes</h1>
  <p class="sub">Every demo vignette from the help page, extracted one per file so a
     single scene can be watched and reworked on its own.
     <code>server/public/help.html</code> is the source of truth; regenerate these with
     <code>node docs/animation/build.js</code>. The 60-second commercial animatic lives
     separately at <a href="one-minute-in.html">one-minute-in.html</a>.</p>
  <div class="grid">
${scenes.map(s => `    <a class="tile" href="${s.file}"><b>${s.title}</b><span>${
      decode(s.body.replace(/<[^>]+>/g, '')).trim().slice(0, 120)}</span></a>`).join('\n')}
  </div>
</div>
${S}try{if(localStorage.getItem('movealong.theme')==='dark')document.body.classList.add('dark');}catch(e){}${ES}
</body></html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), index);

console.log(scenes.length + ' scenes extracted:');
scenes.forEach(s => console.log('  ' + s.file.padEnd(36) + s.title));
