// The site login's one client-side job: when the session cookie is gone or
// expired, a fetch answers 401 with { login: '/login' } instead of a page. Send
// the browser there, remembering this page, so the pane does not quietly stay
// empty. Nothing else: the server answers pages with a redirect on its own.
(function () {
    const real = window.fetch;
    if (!real || real.__moveitSession) return;
    const wrapped = async function (input, init) {
        const res = await real.call(this, input, init);
        if (res.status === 401) {
            try {
                const body = await res.clone().json();
                if (body && body.login) {
                    location.href = body.login + '?next=' + encodeURIComponent(location.pathname + location.search);
                }
            } catch (e) { /* not the site login's 401 */ }
        }
        return res;
    };
    wrapped.__moveitSession = true;
    window.fetch = wrapped;
})();
