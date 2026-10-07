// What the online users list does for one person. The list has one entry per socket, so a person with two
// tabs open is genuinely listed twice (that is deliberate). A reconnect must not leave an extra entry once
// the old socket has closed. A socket that dies without closing (network drop, phone asleep) stays listed
// until Socket.IO's ping timeout (25 s + 20 s by default), which is too slow to wait for in a test.
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
    return { open };
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
    // alice is told of the new page by the typing broadcast that re-sends the whole list
    alice.socket.emit('typing-start', {});
    await until(() => alice.users.length === 2, 'alice to get the list again');
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);
});

test('two open pages for one person are both listed, and each is removed when it closes', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    const bobTab1 = open('bob');
    await until(() => bobTab1.users, 'bob to connect');
    const bobTab2 = open('bob');
    await until(() => bobTab2.users && bobTab2.users.length === 3, 'both bob tabs to be listed');
    assert.deepStrictEqual(bobTab2.users.slice().sort(), ['alice', 'bob', 'bob']);
    bobTab1.socket.close();
    await until(() => alice.users && alice.users.length === 2, 'the closed tab to leave the list');
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);
    bobTab2.socket.close();
    await until(() => alice.users.length === 1, 'the second tab to leave the list');
    assert.deepStrictEqual(alice.users, ['alice']);
});
