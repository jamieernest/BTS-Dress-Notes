// Runs the real server against the stub OIDC provider and checks the login
// itself: where it sends people, that logins in parallel cannot spoil each
// other, that the session rolls, and that logging out closes open pages.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { until, freePort, startOidc, createApp, login } = require('./e2e-harness');

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    t.after(async () => {
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return { app, oidc, base: `http://127.0.0.1:${app.port}` };
}

test('a page asked for without a login goes to /login and comes back to it after', async (t) => {
    const { app, oidc, base } = await setup(t);
    const res = await fetch(`${base}/recall.html?x=1`, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), `/login?returnTo=${encodeURIComponent('/recall.html?x=1')}`);
    assert.deepStrictEqual(res.headers.getSetCookie(), [], 'no session is made for a visitor who is not logged in');

    await login(app, oidc, 'alice', '/recall.html?x=1');
    assert.strictEqual(login.lastRedirect, '/recall.html?x=1');
    await login(app, oidc, 'alice', '//evil.example/');
    assert.strictEqual(login.lastRedirect, '/', 'only paths on this site are returned to');
});

test('a script or fetch without a login gets a 401, not the login page', async (t) => {
    const { base } = await setup(t);
    const res = await fetch(`${base}/index.js`, { redirect: 'manual', headers: { accept: '*/*' } });
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await fetch(`${base}/session`, { redirect: 'manual', headers: { accept: 'application/json' } })).status, 401);
});

test('two logins started at once both succeed', async (t) => {
    const { app, oidc } = await setup(t);
    const base = `http://127.0.0.1:${app.port}`;
    // Both trips to Keycloak start before either comes back, as two tabs bounced to /login at once do.
    const starts = await Promise.all(['alice', 'alice'].map(() => fetch(`${base}/login`, { redirect: 'manual' })));
    oidc.state.nextUser = 'alice';
    const callbacks = [];
    for (const start of starts) callbacks.push((await fetch(start.headers.get('location'), { redirect: 'manual' })).headers.get('location'));
    for (const url of callbacks.reverse()) {
        const res = await fetch(url, { redirect: 'manual' });
        assert.strictEqual(res.status, 302);
        assert.strictEqual(res.headers.get('location'), '/');
        const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
        const me = await fetch(`${base}/session`, { headers: { cookie } });
        assert.strictEqual(me.status, 200);
        assert.strictEqual((await me.json()).name, 'alice');
    }
});

test('a callback URL used twice does not log in again', async (t) => {
    const { app, oidc } = await setup(t);
    const base = `http://127.0.0.1:${app.port}`;
    oidc.state.nextUser = 'alice';
    const start = await fetch(`${base}/login`, { redirect: 'manual' });
    const callback = (await fetch(start.headers.get('location'), { redirect: 'manual' })).headers.get('location');
    assert.strictEqual((await fetch(callback, { redirect: 'manual' })).headers.get('location'), '/');
    const again = await fetch(callback, { redirect: 'manual' });
    assert.strictEqual(again.headers.get('location'), '/login');
    assert.deepStrictEqual(again.headers.getSetCookie(), []);
});

test('each request pushes the session expiry out (rolling login)', async (t) => {
    const { app, oidc, base } = await setup(t);
    const cookie = await login(app, oidc, 'alice');
    const expiry = async () => {
        const res = await fetch(`${base}/session`, { headers: { cookie } });
        assert.strictEqual(res.status, 200);
        const set = res.headers.getSetCookie().find((c) => c.startsWith(cookie.split('=')[0]));
        assert.ok(set, 'the session cookie is sent again');
        return Date.parse(/Expires=([^;]+)/i.exec(set)[1]);
    };
    const first = await expiry();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.ok(await expiry() > first);
});

test('logging out closes that login\'s open pages but not anyone else\'s', async (t) => {
    const { app, oidc, base } = await setup(t);
    const alice = await login(app, oidc, 'alice');
    const bob = await login(app, oidc, 'bob');
    const connect = (cookie) => {
        const page = { loggedOut: false, socket: io(base, { extraHeaders: { cookie }, reconnection: false }) };
        page.socket.on('logged-out', () => { page.loggedOut = true; });
        return page;
    };
    const alicePage = connect(alice);
    const bobPage = connect(bob);
    t.after(() => { alicePage.socket.close(); bobPage.socket.close(); });
    await until(() => alicePage.socket.connected && bobPage.socket.connected, 'both pages to connect');

    // A plain link (GET) does not log out: only the page's form (POST) does.
    await fetch(`${base}/logout`, { redirect: 'manual', headers: { cookie: alice } });
    assert.strictEqual((await fetch(`${base}/session`, { headers: { cookie: alice } })).status, 200);
    await fetch(`${base}/logout`, { method: 'POST', redirect: 'manual', headers: { cookie: alice } });
    await until(() => alicePage.loggedOut && !alicePage.socket.connected, 'alice\'s page to be logged out');
    assert.strictEqual(bobPage.socket.connected, true);
    assert.strictEqual(bobPage.loggedOut, false);
    assert.strictEqual((await fetch(`${base}/session`, { headers: { cookie: alice } })).status, 401);
});
