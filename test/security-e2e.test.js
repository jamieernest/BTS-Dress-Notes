// Runs the real server and checks the defences against script injection: the
// Content-Security-Policy, that no page carries an inline script, that a
// socket from another site's page is refused, and that an imported backup is
// rebuilt from the known fields rather than stored as sent.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { ROOT, until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const cookie = await login(app, oidc, 'alice');
    t.after(async () => {
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return { app, cookie, base: `http://127.0.0.1:${app.port}` };
}

test('pages only run scripts from this site', async (t) => {
    const { base, cookie } = await setup(t);
    const res = await fetch(`${base}/`, { headers: { cookie } });
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.doesNotMatch(csp, /upgrade-insecure-requests/, 'the venue serves plain HTTP');
    assert.strictEqual(res.headers.get('strict-transport-security'), null);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-powered-by'), null);

    for (const page of fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(ROOT, 'public', page), 'utf8');
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${page} has an inline script`);
        assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page} has an inline event handler`);
    }

    const purify = await fetch(`${base}/vendor/purify.min.js`, { headers: { cookie } });
    assert.strictEqual(purify.status, 200);
    assert.match(await purify.text(), /DOMPurify/);
    assert.strictEqual((await fetch(`${base}/vendor/purify.min.js`, { headers: { accept: '*/*' } })).status, 401);
});

test('a socket opened from another site\'s page is refused', async (t) => {
    const { base, cookie } = await setup(t);
    const open = (origin) => new Promise((resolve) => {
        const socket = io(base, { extraHeaders: { cookie, origin }, reconnection: false, transports: ['polling'] });
        socket.on('connect', () => { socket.close(); resolve('connected'); });
        socket.on('connect_error', () => { socket.close(); resolve('refused'); });
    });
    assert.strictEqual(await open('http://evil.example'), 'refused');
    assert.strictEqual(await open(base), 'connected');
});

test('an imported backup keeps only the fields a note can have', async (t) => {
    const { app, cookie } = await setup(t);
    const browser = new Browser(app, cookie);
    t.after(() => browser.close());
    browser.load();
    let tags = [];
    browser.page.socket.on('tags-update', (list) => { tags = list; });
    await until(() => browser.page.socket.connected, 'the page to connect');
    browser.page.socket.emit('import-backup', {
        notes: [{
            id: 'n1', user: 'Alice', text: '<img src=x onerror=alert(1)>', timestamp: '2026-10-16T10:00:00.000Z',
            tags: ['lx'], onclick: 'alert(1)', timecode: { hours: 1, minutes: 2, seconds: 3, style: 'x' }
        }],
        tags: [{ id: 'lx', name: 'LX', color: 'red;background:url(//evil.example)' }]
    });
    await until(() => browser.page.notes.length === 1, 'the imported note');
    const [note] = browser.page.notes;
    assert.strictEqual(note.onclick, undefined);
    assert.strictEqual(note.text, '<img src=x onerror=alert(1)>', 'text is kept as written; the page escapes it');
    assert.deepStrictEqual(note.timecode, { hours: 1, minutes: 2, seconds: 3, frames: 0 });
    await until(() => tags.some((tag) => tag.id === 'lx'), 'the imported tags');
    assert.match(tags.find((tag) => tag.id === 'lx').color, /^#[0-9a-f]{6}$/i);
});
