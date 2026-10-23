// Keeps the login alive while a page is open. The session cookie rolls on with
// every HTTP request (server.js), but a page that only talks over its socket
// makes none, so an overlay or a tab left open all day would otherwise lose
// its login after SESSION_IDLE_MS. This also notices a login that has gone
// (logged out elsewhere, sessions file deleted) while the socket looks fine.
(function (root) {
    const KEEPALIVE_MS = 5 * 60 * 1000;

    // Back through Keycloak to this same page.
    function loginUrl() {
        return '/login?returnTo=' + encodeURIComponent(location.pathname + location.search);
    }

    // `onLoggedOut` runs when the server says the login is gone.
    function keepLoginAlive(onLoggedOut) {
        function check() {
            fetch('/session', { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' })
                .then((res) => { if (res.status === 401) onLoggedOut(); })
                .catch(() => { /* offline: the page's own connection status says so */ });
        }
        setInterval(check, KEEPALIVE_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') check();
        });
    }

    // Logged out on purpose (in another tab): say so rather than log back in.
    function loggedOutUrl() {
        return '/logged-out?returnTo=' + encodeURIComponent(location.pathname + location.search);
    }

    root.keepLoginAlive = keepLoginAlive;
    root.loginUrl = loginUrl;
    root.loggedOutUrl = loggedOutUrl;
}(self));
