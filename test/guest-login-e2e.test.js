// The real server with Keycloak off: people pick a name, and everything that
// follows (session, sockets, note authors, the online list) is as with Keycloak.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT, until, freePort, createApp, cookiesOf, Browser } = require('./e2e-harness');

async function setup(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-login-e2e-'));
    const app = createApp({ sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    t.after(async () => { await app.stop().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
    return { app, base: `http://127.0.0.1:${app.port}` };
}

async function signIn(base, name, returnTo = '/') {
    const res = await fetch(`${base}/login`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name, returnTo })
    });
    return { res, cookie: cookiesOf(res) };
}

test('without Keycloak a page asks for a name, and the name is the login', async (t) => {
    const { app, base } = await setup(t);
    assert.match(app.output(), /Keycloak login is OFF/);
    const page = await fetch(`${base}/config.html`, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.strictEqual(page.headers.get('location'), `/login?returnTo=${encodeURIComponent('/config.html')}`);
    const form = await (await fetch(`${base}/login?returnTo=${encodeURIComponent('/config.html?"x')}`)).text();
    assert.match(form, /name="returnTo" value="\/config\.html\?&#34;x"/, 'the page to return to is escaped');
    assert.strictEqual((await fetch(`${base}/index.js`, { redirect: 'manual' })).status, 401);

    const { res, cookie } = await signIn(base, '  Sam   K  ', '/config.html');
    assert.strictEqual(res.headers.get('location'), '/config.html');
    const me = await (await fetch(`${base}/session`, { headers: { cookie } })).json();
    assert.strictEqual(me.name, 'Sam K');
    assert.strictEqual(me.sub, 'guest:sam k');
    assert.strictEqual((await fetch(`${base}/config.html`, { headers: { cookie } })).status, 200);

    assert.strictEqual((await signIn(base, '   ')).res.headers.get('location'), '/login?returnTo=%2F', 'a blank name asks again');
    assert.strictEqual((await signIn(base, 'x', '//evil.example/')).res.headers.get('location'), '/', 'only paths on this site are returned to');
    assert.strictEqual((await fetch(`${base}/callback?state=x`, { redirect: 'manual' })).headers.get('location'), '/login');
});

test('a name on a form from another site is refused', async (t) => {
    const { base } = await setup(t);
    const res = await fetch(`${base}/login`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
        body: new URLSearchParams({ name: 'mallory' })
    });
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(res.headers.getSetCookie(), []);
});

test('the same name is the same person on any device; different names are different people', async (t) => {
    const { app, base } = await setup(t);
    const sam = new Browser(app, (await signIn(base, 'Sam')).cookie);
    const samPhone = new Browser(app, (await signIn(base, 'sam')).cookie);
    const kit = new Browser(app, (await signIn(base, 'Kit')).cookie);
    t.after(() => { sam.close(); samPhone.close(); kit.close(); });
    sam.load(); samPhone.load(); kit.load();

    sam.note('written by sam');
    await until(() => kit.noteTexts().includes('written by sam'), 'the note to reach everyone');
    const note = kit.page.notes.find((n) => n.text === 'written by sam');
    assert.strictEqual(note.userId, 'guest:sam');
    assert.strictEqual(note.user, 'Sam');

    const edit = (browser, newText) => browser.page.socket.emit('note-edit-text', { noteId: note.id, newText });
    const texts = [];
    sam.page.socket.on('note-edit-text', (e) => texts.push(e.newText ?? e.text));
    edit(kit, 'kit edits it');
    edit(samPhone, 'sam edits it from the phone');
    await until(() => texts.length > 0, 'an edit to be accepted');
    assert.strictEqual(texts.length, 1, 'only one of the two edits went through');
    assert.match(texts[0], /sam edits it from the phone/);
});

test('logging out ends at the logged-out page, which leads back to the name form', async (t) => {
    const { base } = await setup(t);
    const { cookie } = await signIn(base, 'Sam');
    const out = await fetch(`${base}/logout`, { method: 'POST', redirect: 'manual', headers: { cookie } });
    assert.strictEqual(out.headers.get('location'), '/logged-out');
    assert.strictEqual((await fetch(`${base}/session`, { headers: { cookie } })).status, 401);
    assert.match(await (await fetch(`${base}/logged-out`)).text(), /href="\/login"/);
});

test('Keycloak settings with no KEYCLOAK_ENABLED stop the server instead of opening it', async () => {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(await freePort()), SESSION_SECRET: 'x', KEYCLOAK_ENABLED: '', KEYCLOAK_ISSUER: 'http://127.0.0.1:1', KEYCLOAK_CLIENT_ID: 'bts', KEYCLOAK_CLIENT_SECRET: 'x' }
    });
    let out = '';
    child.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.strictEqual(code, 1);
    assert.match(out, /KEYCLOAK_ENABLED/);
});
