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

const sleepBriefly = () => new Promise((resolve) => setTimeout(resolve, 300));

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
    // `device` is the browser's saved id (shared by its tabs); `userAgent` what it says it is.
    const open = (who, device = `${who}-device-1`, userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36') => {
        const page = { users: null, full: null, socket: io(`http://127.0.0.1:${app.port}`, { auth: { deviceId: device }, extraHeaders: { cookie: cookies[who], 'user-agent': userAgent }, reconnection: false }) };
        page.socket.on('users-update', (users) => { page.full = users; page.users = users.map((u) => u.name); });
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

test('tabs of one device are listed as one person with one device, and removed when the last closes', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    const bobTab1 = open('bob');
    await until(() => bobTab1.users, 'bob to connect');
    const bobTab2 = open('bob'); // same device id: another tab
    await until(() => bobTab2.users && bobTab2.users.length === 2, 'bob to be listed');
    assert.deepStrictEqual(bobTab2.users.slice().sort(), ['alice', 'bob']);
    await until(() => alice.users && alice.users.length === 2, 'alice to be told of bob');
    assert.deepStrictEqual(alice.full.find((u) => u.name === 'bob').devices.map((d) => d.label), ['Chrome, Windows']);
    bobTab1.socket.close();
    await sleepBriefly();
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);
    bobTab2.socket.close();
    await until(() => alice.users.length === 1, 'bob to leave the list');
    assert.deepStrictEqual(alice.users, ['alice']);
});

test('one person on two devices is one entry that lists both devices', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    open('bob', 'bob-laptop', 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36');
    const phone = open('bob', 'bob-phone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1');
    await until(() => alice.full && alice.full.some((u) => u.devices.length === 2), 'bob to be listed on two devices');
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);
    assert.deepStrictEqual(alice.full.find((u) => u.name === 'bob').devices.map((d) => d.label), ['Chrome, Windows', 'Safari, iOS']);
    phone.socket.close();
    await until(() => alice.full.find((u) => u.name === 'bob').devices.length === 1, 'the phone to leave');
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);
});

test('a person whose old page has not closed yet is still listed once after reconnecting', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    const bobOld = open('bob');
    await until(() => bobOld.users, 'bob to connect');
    // reconnecting before the old socket is gone, as after config.html -> back
    const bobNew = open('bob');
    await until(() => alice.users && alice.users.length === 2, 'bob to be listed');
    bobOld.socket.close();
    bobNew.socket.emit('typing-start', {});
    await until(() => alice.users.length === 2, 'the list to be sent again');
    assert.deepStrictEqual(alice.users.slice().sort(), ['alice', 'bob']);
});

test('everyone is sent the new list when someone joins', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    await until(() => alice.users, 'alice to connect');
    open('bob');
    await until(() => alice.users.length === 2, 'alice to see bob without anyone typing');
});

test('a person shows as typing while any of their devices is typing', async (t) => {
    const { open } = await setup(t);
    const alice = open('alice');
    alice.socket.on('users-update', (users) => { alice.typing = users.filter((u) => u.isTyping).map((u) => u.name); });
    const bobTab1 = open('bob', 'bob-laptop');
    const bobTab2 = open('bob', 'bob-phone');
    await until(() => alice.full && alice.full.some((u) => u.devices.length === 2), 'bob to be listed');
    bobTab2.socket.emit('typing-start', {});
    await until(() => alice.typing && alice.typing.length === 1, 'bob to show as typing');
    assert.deepStrictEqual(alice.typing, ['bob']);
    bobTab2.socket.emit('typing-stop');
    await until(() => alice.typing.length === 0, 'bob to stop typing');
    bobTab1.socket.close();
});
