const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileSessionStore } = require('../session-store');

const HOUR = 60 * 60 * 1000;

function tempFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sessions-'));
    return path.join(dir, 'local-sessions.json');
}

function sessionExpiringAt(time, user = { id: 'sub-1', name: 'Alice' }) {
    return { cookie: { originalMaxAge: 12 * HOUR, expires: new Date(time).toISOString(), httpOnly: true, path: '/' }, user };
}

function get(store, sid) {
    return new Promise((resolve, reject) => store.get(sid, (err, sess) => (err ? reject(err) : resolve(sess))));
}

function newStore(file, clock) {
    return new FileSessionStore({ file, pruneIntervalMs: 0, now: () => clock.now });
}

test('a saved session loads back after a restart', async () => {
    const file = tempFile();
    const clock = { now: Date.parse('2026-09-24T18:00:00Z') };
    const before = newStore(file, clock);
    const sess = sessionExpiringAt(clock.now + 12 * HOUR);
    before.set('abc', sess);
    assert.strictEqual(fs.existsSync(`${file}.tmp`), false);

    const after = newStore(file, clock);
    assert.deepStrictEqual(await get(after, 'abc'), sess);
    assert.strictEqual(await get(after, 'missing'), null);
});

test('a destroyed session is gone after a restart', async () => {
    const file = tempFile();
    const clock = { now: Date.parse('2026-09-24T18:00:00Z') };
    const store = newStore(file, clock);
    store.set('abc', sessionExpiringAt(clock.now + HOUR));
    store.destroy('abc');
    assert.strictEqual(await get(newStore(file, clock), 'abc'), null);
});

test('expired sessions are not returned and are pruned from the file', async () => {
    const file = tempFile();
    const clock = { now: Date.parse('2026-09-24T18:00:00Z') };
    const store = newStore(file, clock);
    store.set('short', sessionExpiringAt(clock.now + HOUR));
    store.set('long', sessionExpiringAt(clock.now + 12 * HOUR));

    clock.now += 2 * HOUR;
    assert.strictEqual(await get(store, 'short'), null);
    store.prune();
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['long']);

    clock.now += 11 * HOUR;
    store.prune();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
});

test('sessions that expired while the server was down are dropped on load', async () => {
    const file = tempFile();
    const clock = { now: Date.parse('2026-09-24T18:00:00Z') };
    newStore(file, clock).set('abc', sessionExpiringAt(clock.now + HOUR));
    clock.now += 2 * HOUR;
    assert.strictEqual(await get(newStore(file, clock), 'abc'), null);
});

test('a missing or corrupt session file starts with no sessions', async () => {
    const file = tempFile();
    const clock = { now: Date.now() };
    assert.strictEqual(await get(newStore(file, clock), 'abc'), null);
    fs.writeFileSync(file, '{ not json');
    assert.strictEqual(await get(newStore(file, clock), 'abc'), null);
});

test('changing a stored session object does not change the stored copy', async () => {
    const file = tempFile();
    const clock = { now: Date.now() };
    const store = newStore(file, clock);
    const sess = sessionExpiringAt(clock.now + HOUR);
    store.set('abc', sess);
    sess.user.name = 'Mallory';
    (await get(store, 'abc')).user.name = 'Eve';
    assert.strictEqual((await get(store, 'abc')).user.name, 'Alice');
});

test('a session without a user is not written to the file and does not survive a restart', async () => {
    const file = tempFile();
    const clock = { now: Date.parse('2026-09-24T18:00:00Z') };
    const store = newStore(file, clock);
    const loginInProgress = { cookie: sessionExpiringAt(clock.now + 12 * HOUR).cookie, returnTo: '/', oidc: { state: 's' } };
    store.set('anon', loginInProgress);
    assert.strictEqual(fs.existsSync(file), false);
    assert.deepStrictEqual(await get(store, 'anon'), loginInProgress);

    store.set('abc', sessionExpiringAt(clock.now + 12 * HOUR));
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['abc']);
    assert.strictEqual(await get(newStore(file, clock), 'anon'), null);
});

test('a session without a user expires after 15 minutes, and logging in keeps it for the cookie lifetime', async () => {
    const file = tempFile();
    const clock = { now: Date.parse('2026-09-24T18:00:00Z') };
    const store = newStore(file, clock);
    const cookie = sessionExpiringAt(clock.now + 12 * HOUR).cookie;
    store.set('anon', { cookie, returnTo: '/' });
    store.set('login', { cookie, returnTo: '/' });

    clock.now += 10 * 60 * 1000;
    const loggedIn = { cookie, user: { id: 'sub-1', name: 'Alice' } };
    store.set('login', loggedIn);

    clock.now += 6 * 60 * 1000;
    assert.strictEqual(await get(store, 'anon'), null);
    assert.deepStrictEqual(await get(store, 'login'), loggedIn);

    clock.now += 11 * HOUR;
    store.prune();
    assert.deepStrictEqual(await get(newStore(file, clock), 'login'), loggedIn);
});

test('a session that loses its user is removed from the file', async () => {
    const file = tempFile();
    const clock = { now: Date.parse('2026-09-24T18:00:00Z') };
    const store = newStore(file, clock);
    const sess = sessionExpiringAt(clock.now + 12 * HOUR);
    store.set('abc', sess);
    store.set('abc', { cookie: sess.cookie });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
});
