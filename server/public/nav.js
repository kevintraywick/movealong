// The board's header, on every page of your own (Kevin, 2026-10-01: "keep the
// nav bar on all sub pages"). It replaced each page's "Back to your board"
// link: the way back is the board's own tab, as it is on the board.
//
// Load it as the first thing in <body>: it writes the header in place,
// synchronously, so the page's own script finds #themeToggle and wires it as
// before. The board-only controls (+, the 🧠 🔎 📅 switches, focus, the view
// toggle) stay on the board; everything else is here, in the same order and
// the same styles, copied from index.html's .app-header rules.
(function () {
    let sess = null;
    try { sess = JSON.parse(localStorage.getItem('movealong.session') || 'null'); } catch (e) { /* signed out */ }
    const here = location.pathname.replace(/\/+$/, '').replace(/\.html$/, '') || '/';
    const esc = (t) => { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };

    const PAGES = [
        { id: 'notesLink', href: '/notes', label: 'Notes', title: 'Notes — quotes, ideas and feature requests you sent yourself',
          svg: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M9 12h6"/><path d="M9 16h4"/>' },
        { id: 'dashboardLink', href: '/dashboard', label: 'Dashboard', title: "Dashboard — what you've completed this month",
          svg: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>' },
        { id: 'goalsLink', href: '/goals', label: 'Goals', title: "Goals — what matters, in order, and the sprint you're on",
          svg: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' },
        { id: 'listsLink', href: '/lists', label: 'Lists', title: 'Lists — the lists you keep, ready to drop onto any day',
          svg: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.6" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="18" r="1.1" fill="currentColor" stroke="none"/>' },
    ];

    const css = `
        .mi-nav {
            position: sticky; top: 0; z-index: 90;
            display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
            min-height: 44px; margin: -20px -20px 16px; padding: 4px 20px;
            background: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            border-bottom: 1px solid #e8edf3;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;
        }
        .mi-nav .mi-logo {
            font-family: 'Bricolage Grotesque', -apple-system, sans-serif; font-weight: 800; font-size: 17px;
            letter-spacing: -0.03em; color: #0f172a; white-space: nowrap; text-decoration: none;
        }
        .mi-nav .mi-logo span { color: #0ea5e9; }
        .mi-nav .mi-icon {
            width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0;
            border: 1px solid #e2e8f0; background: transparent; color: #0284c7;
            display: flex; align-items: center; justify-content: center; text-decoration: none;
            transition: all 0.2s; position: relative; margin-right: 4px;
        }
        .mi-nav #notesLink { margin-left: auto; }   /* floats the middle group, as on the board */
        .mi-nav .mi-icon:hover { background: #f0f9ff; color: #0ea5e9; border-color: #bae6fd; }
        /* The page you're on, lit the way the board's own tab is. */
        .mi-nav .mi-icon.here { background: #f0f9ff; border-color: #38bdf8; }
        .mi-nav .mi-icon svg {
            width: 15px; height: 15px; display: block; stroke: currentColor; fill: none;
            stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
        }
        .mi-nav .mi-icon.unread::after {
            content: ''; position: absolute; top: 3px; right: 3px;
            width: 6px; height: 6px; border-radius: 50%; background: #0ea5e9;
        }
        .mi-nav .mi-tabs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-right: auto; margin-left: 10px; }
        .mi-nav .mi-tab {
            padding: 3px 10px; border-radius: 6px; font-size: 12px; white-space: nowrap; text-decoration: none;
            border: 1px solid #e2e8f0; background: #ffffff; color: #475569; cursor: pointer;
            transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .mi-nav .mi-tab:hover { border-color: #38bdf8; color: #0284c7; background: #f0f9ff; }
        .mi-nav .mi-tab.due, .mi-nav .mi-tab.due:hover { border: 2px solid #ef4444; padding: 2px 9px; }
        .mi-nav .mi-theme {
            width: 26px; height: 26px; border-radius: 6px; border: none; background: transparent;
            font-size: 14px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .mi-nav .mi-theme:hover { background: #f0f9ff; }
        .mi-nav .mi-who { font-size: 12px; color: #94a3b8; font-weight: 500; padding: 4px 8px; white-space: nowrap; }
        .mi-nav .mi-who i { font-style: normal; color: #cbd5e1; margin: 0 8px; }
        .mi-nav .mi-help {
            width: 20px; height: 20px; border-radius: 50%; background: #0ea5e9; color: #fff;
            font-size: 11px; font-weight: 700; line-height: 1; flex-shrink: 0; text-decoration: none;
            display: flex; align-items: center; justify-content: center;
        }
        .mi-nav .mi-help:hover { background: #0284c7; box-shadow: 0 1px 4px rgba(14, 165, 233, 0.4); }
        body.dark .mi-nav { background: rgba(15, 23, 42, 0.85); border-bottom-color: #1e293b; }
        body.dark .mi-nav .mi-logo { color: #f1f5f9; }
        body.dark .mi-nav .mi-icon { color: #38bdf8; border-color: #334155; }
        body.dark .mi-nav .mi-icon:hover { background: rgba(14, 165, 233, 0.12); border-color: #0284c7; }
        body.dark .mi-nav .mi-icon.here { background: rgba(14, 165, 233, 0.15); border-color: #38bdf8; }
        body.dark .mi-nav .mi-tab { background: #1e293b; border-color: #334155; color: #94a3b8; }
        body.dark .mi-nav .mi-tab:hover { border-color: #38bdf8; color: #38bdf8; background: rgba(14, 165, 233, 0.12); }
        body.dark .mi-nav .mi-tab.due, body.dark .mi-nav .mi-tab.due:hover { border-color: #ef4444; }
        body.dark .mi-nav .mi-theme { background: transparent; border: none; }
        body.dark .mi-nav .mi-theme:hover { background: rgba(14, 165, 233, 0.12); }
        body.dark .mi-nav .mi-who i { color: #475569; }
        @media (max-width: 640px) {
            .mi-nav { margin: -20px -20px 12px; padding: 4px 12px; gap: 10px; }
            .mi-nav .mi-who { display: none; }
        }`;

    const icons = PAGES.map(p => `<a class="mi-icon${here === p.href ? ' here' : ''}" id="${p.id}" href="${p.href}" title="${esc(p.title)}" aria-label="${p.label}"${here === p.href ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${p.svg}</svg></a>`).join('');
    document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
    // The theme button keeps the id each page's own script already wires.
    document.currentScript.insertAdjacentHTML('beforebegin', `
        <header class="app-header mi-nav">
            <a class="mi-logo" href="/" title="Back to your board">Move<span>It</span></a>
            ${icons}
            <div class="mi-tabs" id="miTabs"></div>
            <button class="mi-theme" id="themeToggle" title="Switch theme" aria-label="Switch between light and dark mode">🌙</button>
            <span class="mi-who" id="miWho"></span>
            <a class="mi-help" href="/help" target="_blank" rel="noopener" title="Help — features, gestures, and running your own copy" aria-label="Help">?</a>
        </header>`);

    if (!sess) return;
    const me = `/api/companies/${encodeURIComponent(sess.subdomain)}/users/${encodeURIComponent(sess.slug)}`;
    const get = (path) => fetch(path, { headers: { 'x-tz': Intl.DateTimeFormat().resolvedOptions().timeZone } }).then(r => r.ok ? r.json() : Promise.reject(r.status));

    // The boards, in the user's own order. A tab takes you to that board: it
    // becomes the board the session opens on, then the board loads.
    get(`${me}/projects`).then(projects => {
        const tabs = document.getElementById('miTabs');
        tabs.innerHTML = projects.map(p => {
            const due = p.due_today > 0 ? p.due_today : 0;
            const title = due ? `${due} deadline${due === 1 ? '' : 's'} due — go to ${p.name}` : `Go to ${p.name}`;
            return `<a class="mi-tab${due ? ' due' : ''}" href="/" data-project-id="${p.id}" title="${esc(title)}">${esc(p.name)}</a>`;
        }).join('');
        tabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.mi-tab');
            if (!tab) return;
            try { localStorage.setItem('movealong.session', JSON.stringify({ ...sess, projectId: parseInt(tab.dataset.projectId) })); } catch (err) { /* the board opens on its last one */ }
        });
    }).catch(() => {});

    // You · your team, the board's account chip.
    Promise.all([get(me), get(`/api/companies/${encodeURIComponent(sess.subdomain)}`).catch(() => ({}))]).then(([u, c]) => {
        document.getElementById('miWho').innerHTML = `${esc(u.name || sess.slug)}<i>&bull;</i>${esc(c.name || sess.subdomain)}`;
    }).catch(() => {});

    // The board's dot for notes that arrived since the notes page was last
    // opened. The notes page itself clears it by visiting.
    if (here !== '/notes') {
        const since = localStorage.getItem('movealong.notes.seen');
        get(`${me}/notes${since ? `?count=1&since=${encodeURIComponent(since)}` : '?count=1'}`).then(r => {
            const link = document.getElementById('notesLink');
            if (link && r.count) { link.classList.add('unread'); link.title = `Notes — ${r.count} new since you last looked`; }
        }).catch(() => {});
    }
})();
