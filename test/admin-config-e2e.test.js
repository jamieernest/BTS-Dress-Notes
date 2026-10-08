// The config page and its controls are for the people in the admin list (admins.js):
// the page itself, and the socket events behind it, which any logged-in user could
// otherwise send without ever opening the page.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { sleep, until, freePort, startOidc, createApp, login } = require('./e2e-harness');

async function setup(t, { admins } = {}) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-config-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    if (admins) fs.writeFileSync(app.adminsFile, JSON.stringify(admins));
    await app.start();
    const cookies = { alice: await login(app, oidc, 'alice'), bob: await login(app, oidc, 'bob') };
    const sockets = [];
    t.after(async () => {
        sockets.forEach((s) => s.close());
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const get = (who, urlPath) => fetch(`http://127.0.0.1:${app.port}${urlPath}`, { headers: { cookie: cookies[who] }, redirect: 'manual' });
    // A page for `who` that records what the server sends it.
    const open = (who, referer = '/') => {
        const page = { events: [], socket: io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie: cookies[who], referer: `http://127.0.0.1:${app.port}${referer}` }, reconnection: false }) };
        for (const event of ['current-user', 'settings-options', 'time-mode-update', 'eos-status', 'notes-update', 'system-status']) {
            page.socket.on(event, (data) => page.events.push({ event, data }));
        }
        page.last = (event) => { const e = page.events.filter((x) => x.event === event); return e.length ? e[e.length - 1].data : undefined; };
        page.count = (event) => page.events.filter((x) => x.event === event).length;
        sockets.push(page.socket);
        return page;
    };
    return { app, get, open };
}

test('only an admin can load the config page, however its address is written', async (t) => {
    const { get } = await setup(t, { admins: ['alice'] });
    for (const p of ['/config.html', '/config.js']) {
        assert.strictEqual((await get('alice', p)).status, 200, `alice ${p}`);
        assert.strictEqual((await get('bob', p)).status, 403, `bob ${p}`);
    }
    for (const p of ['/Config.html', '/CONFIG.HTML', '/%63onfig.html', '/config.html?x=1', '/%43onfig.JS']) {
        assert.strictEqual((await get('bob', p)).status, 403, `bob ${p}`);
    }
    assert.strictEqual((await get('bob', '/')).status, 200, 'the main page stays open to everyone');
    assert.strictEqual((await get('bob', '/config-style.css')).status, 200, 'stylesheet is not secret');
});

test('with no admin list everybody can use the config page, as before', async (t) => {
    const { get, open } = await setup(t);
    assert.strictEqual((await get('bob', '/config.html')).status, 200);
    const bob = open('bob');
    await until(() => bob.last('current-user'), 'bob to connect');
    assert.strictEqual(bob.last('current-user').isAdmin, true);
});

test('a socket is told whether it is an admin, and only admins get the config options', async (t) => {
    const { open } = await setup(t, { admins: ['alice'] });
    const alice = open('alice', '/config.html');
    const bob = open('bob');
    await until(() => alice.last('current-user') && bob.last('current-user'), 'both to connect');
    assert.strictEqual(alice.last('current-user').isAdmin, true);
    assert.strictEqual(bob.last('current-user').isAdmin, false);
    await until(() => alice.last('settings-options'), 'alice to get the options');
    await sleep(300);
    assert.strictEqual(bob.count('settings-options'), 0, 'bob is not sent MIDI ports or interface addresses');
});

test("a non-admin's config controls do nothing; an admin's work", async (t) => {
    const { open } = await setup(t, { admins: ['alice'] });
    const alice = open('alice', '/config.html');
    const bob = open('bob');
    await until(() => alice.last('time-mode-update') && bob.last('time-mode-update'), 'both to connect');
    await until(() => bob.last('notes-update'), 'bob to get notes');

    // time mode
    bob.socket.emit('time-mode-change', 'network');
    await sleep(400);
    assert.notStrictEqual(alice.last('time-mode-update'), 'network', 'bob cannot change the time mode');
    alice.socket.emit('time-mode-change', 'network');
    await until(() => bob.last('time-mode-update') === 'network', 'alice to change the time mode');

    // reconnecting to Eos
    const statusBefore = bob.count('eos-status');
    bob.socket.emit('eos-reconnect');
    await sleep(400);
    assert.strictEqual(bob.count('eos-status'), statusBefore, 'bob cannot reconnect Eos');
    alice.socket.emit('eos-reconnect');
    await until(() => bob.count('eos-status') > statusBefore, 'alice to reconnect Eos');

    // resetting notes and chat
    bob.socket.emit('note-submit', { text: 'keep me', clientId: 'c1', timecode: { hours: 0, minutes: 0, seconds: 1, frames: 0 }, tags: [] });
    await sleep(300);
    const notesNow = () => new Promise((resolve) => {
        const probe = io(bob.socket.io.uri, { extraHeaders: bob.socket.io.opts.extraHeaders, reconnection: false });
        probe.on('notes-update', (n) => { probe.close(); resolve(n.map((x) => x.text)); });
    });
    assert.deepStrictEqual(await notesNow(), ['keep me']);
    bob.socket.emit('reset-all');
    await sleep(400);
    assert.deepStrictEqual(await notesNow(), ['keep me'], 'bob cannot reset the notes');
    alice.socket.emit('reset-all');
    await until(async () => (await notesNow()).length === 0, 'alice to reset the notes');
});

test('the main page falls back to real time for anyone when there is no MIDI input', async (t) => {
    const { open } = await setup(t, { admins: ['alice'] });
    const alice = open('alice', '/config.html');
    const bob = open('bob');
    await until(() => bob.last('system-status') && alice.last('time-mode-update'), 'both to connect');
    if (bob.last('system-status').midiAvailable) return t.skip('this machine has a MIDI input');
    alice.socket.emit('time-mode-change', 'midi');
    await until(() => bob.last('time-mode-update') === 'midi', 'the mode to be midi');
    bob.socket.emit('time-mode-change', 'realtime'); // what index.js does on seeing no MIDI
    await until(() => alice.last('time-mode-update') === 'realtime', 'the fallback to real time');
    bob.socket.emit('time-mode-change', 'network'); // but nothing else
    await sleep(400);
    assert.strictEqual(alice.last('time-mode-update'), 'realtime');
});

test('claiming to be the config page by referer gives no access', async (t) => {
    const { open } = await setup(t, { admins: ['alice'] });
    const bob = open('bob', '/config.html');
    await until(() => bob.last('time-mode-update'), 'bob to connect');
    bob.socket.emit('time-mode-change', 'network');
    await sleep(400);
    assert.notStrictEqual(bob.last('time-mode-update'), 'network');
});
