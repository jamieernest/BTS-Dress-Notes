// What the online users list does for one person. The list has one entry per person (Keycloak account),
// however many pages they have open, so a second tab, a reload or a visit to the recall page and back never
// lists anyone twice; they leave the list when their last page closes. The config page and overlays are not
// listed at all.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { until, freePort, startOidc, createApp, login } = require('./e2e-harness');

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'online-users-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const cookies = { alice: await login(app, oidc, 'alice'), bob: await login(app, oidc, 'bob') };
    const sockets = [];
    t.after(async () => {
        sockets.forEach((s) => s.close());
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    // A page for `who`; `users` is the latest list the server sent it.
    const open = (who) => {
        const page = { users: null, socket: io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie: cookies[who] }, reconnection: false }) };
        page.socket.on('users-update', (users) => { page.users = users.map((u) => u.name); });
        sockets.push(page.socket);
        return page;
    };
    // A config page or overlay, identified in the handshake rather than by referer.
    const openAs = (who, page) => {
        const socket = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie: cookies[who] }, auth: { page }, reconnection: false });
        sockets.push(socket);
        return socket;
    };
    return { open, openAs };
}

test('closing a page and opening it again lists the person once', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    const bob = open('bob');
    await until(() => bob.users && bob.users.length === 2, 'both users to be listed');
    bob.socket.close();
    await until(() => alice.users && alice.users.length === 1, 'bob to leave the list');
    const bobAgain = open('bob');
    await until(() => bobAgain.users, 'the reconnected page to get the list');
    assert.deepStrictEqual(bobAgain.users.slice().sort(), ['alice', 'bob']);
    // everyone is sent the new list when someone joins
    await until(() => alice.users.length === 2, 'alice to get the new list');
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);
});

test('a person with several pages open is listed once, until their last page closes', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    await until(() => alice.users, 'alice to connect');
    const joined = [];
    const left = [];
    alice.socket.on('user-joined', (d) => joined.push(d.user));
    alice.socket.on('user-left', (d) => left.push(d.user));
    const bobTab1 = open('bob');
    await until(() => alice.users && alice.users.length === 2, 'bob to be listed');
    const bobTab2 = open('bob');
    await until(() => bobTab2.users, 'the second bob tab to connect');
    assert.deepStrictEqual(bobTab2.users.slice().sort(), ['alice', 'bob']);
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);

    bobTab1.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob'], 'bob still has a page open');
    assert.deepStrictEqual(left, []);

    bobTab2.socket.close();
    await until(() => alice.users.length === 1, 'bob to leave the list');
    assert.deepStrictEqual(alice.users, ['alice']);
    assert.deepStrictEqual(joined, ['bob']);
    assert.deepStrictEqual(left, ['bob']);
});

test('a person is shown typing while any of their pages is', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    const typing = {};
    alice.socket.on('users-update', (users) => { for (const u of users) typing[u.name] = u.isTyping; });
    const bobTab1 = open('bob');
    const bobTab2 = open('bob');
    await until(() => bobTab1.users && bobTab2.users && alice.users.length === 2, 'bob to connect twice');
    bobTab1.socket.emit('typing-start', { timecode: { hours: 1, minutes: 2, seconds: 3, frames: 4 } });
    await until(() => typing.bob === true, 'bob to be shown typing');
    bobTab2.socket.emit('typing-stop');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(typing.bob, true, 'the other tab is still typing');
    bobTab1.socket.emit('typing-stop');
    await until(() => typing.bob === false, 'bob to stop typing');
});

test('pages that say they are the config page or an overlay are not listed', async (t) => {
    const { open, openAs } = await setup(t);
    const alice = open('alice');
    await until(() => alice.users && alice.users.length === 1, 'alice to be listed');
    const config = openAs('bob', 'config');
    const overlay = openAs('bob', 'overlay');
    await until(() => config.connected && overlay.connected, 'the config page and overlay to connect');
    alice.socket.emit('typing-start', {}); // forces a fresh list to everyone
    await until(() => alice.users && alice.users.length === 1, 'the list to come back');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepStrictEqual(alice.users, ['alice']);
});
