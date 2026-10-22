// Runs the real server (login included, against a stub OIDC provider) with two
// signed-in users, stops and restarts it, and checks the chat comes back. A
// "browser" is a Socket.IO client plus a storage object that outlives page
// loads, driven by the same public/chat-copy.js the page uses, so a reload is
// modelled as throwing the client away and building a new one over the same
// storage. Only the DOM is left out.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createChatCopy, MAX_AGE_MS, MAX_OFFER_CHARS } = require('../public/chat-copy.js');
const { sleep, until, freePort, startOidc, createApp, login, Browser, serverLog } = require('./e2e-harness');

async function setup(t, env) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-restore-e2e-'));
    const sessionsFile = path.join(dir, 'sessions.json');
    const app = createApp({ issuer: oidc.issuer, sessionsFile, port: await freePort(), env });
    await app.start();
    const alice = new Browser(app, await login(app, oidc, 'alice'));
    const bob = new Browser(app, await login(app, oidc, 'bob'));
    t.after(async () => {
        alice.close();
        bob.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    alice.load();
    bob.load();
    alice.say('hello from alice');
    await until(() => bob.texts()?.length === 1, 'bob to see the first message'); // keeps the order fixed
    bob.say('hello from bob');
    await until(() => alice.texts()?.length === 2 && bob.texts()?.length === 2, 'both browsers to see the chat');
    const carol = await login(app, oidc, 'carol');
    return { oidc, app, alice, bob, carol, sessionsFile, expected: ['hello from alice', 'hello from bob'] };
}

test('two users who stay on their pages get the chat back after a restart', async (t) => {
    const { app, alice, bob, carol, expected } = await setup(t);
    await app.stop();
    await app.start();
    await until(async () => (await serverLog(app, carol))?.length, 'the chat to be restored');
    assert.deepStrictEqual(await serverLog(app, carol), expected);
    await until(() => alice.texts()?.length && bob.texts()?.length, 'both pages to show the chat');
    assert.deepStrictEqual(alice.texts(), expected);
    assert.deepStrictEqual(bob.texts(), expected);
});

test('two users who reload their pages while the server is down get the chat back', async (t) => {
    const { app, alice, bob, carol, expected } = await setup(t);
    await app.stop();
    alice.close();
    bob.close();
    await app.start();
    alice.load();
    bob.load();
    await until(async () => (await serverLog(app, carol))?.length, 'the chat to be restored');
    assert.deepStrictEqual(await serverLog(app, carol), expected);
    await until(() => alice.texts()?.length && bob.texts()?.length, 'both pages to show the chat');
    assert.deepStrictEqual(alice.texts(), expected);
    assert.deepStrictEqual(bob.texts(), expected);
});

test('two users sent back through login after a restart get the chat back', async (t) => {
    const { oidc, app, alice, bob, sessionsFile, expected } = await setup(t);
    await app.stop();
    alice.close();
    bob.close();
    fs.rmSync(sessionsFile, { force: true }); // the restart lost every login session
    await app.start();
    alice.cookie = await login(app, oidc, 'alice');
    bob.cookie = await login(app, oidc, 'bob');
    const carol = await login(app, oidc, 'carol');
    alice.load();
    bob.load();
    await until(async () => (await serverLog(app, carol))?.length, 'the chat to be restored');
    assert.deepStrictEqual(await serverLog(app, carol), expected);
    await until(() => alice.texts()?.length && bob.texts()?.length, 'both pages to show the chat');
    assert.deepStrictEqual(alice.texts(), expected);
    assert.deepStrictEqual(bob.texts(), expected);
});

test('one user reloading in two tabs does not count as two users', async (t) => {
    const { app, alice, bob, carol } = await setup(t);
    await app.stop();
    alice.close();
    bob.close(); // bob is away: only alice's browser offers the log
    await app.start();
    alice.load();
    const second = new Browser(app, alice.cookie);
    second.items = alice.items;
    second.load();
    t.after(() => second.close());
    await sleep(500);
    assert.deepStrictEqual(await serverLog(app, carol), []);
});

test('a chat copy older than two hours is not offered', () => {
    assert.strictEqual(MAX_AGE_MS, 2 * 60 * 60 * 1000);
    let clock = 1_000_000;
    const items = new Map();
    const storage = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
    createChatCopy(storage, () => clock).onMessageAdded([{ id: 'a' }]);
    clock += MAX_AGE_MS - 1;
    assert.deepStrictEqual(createChatCopy(storage, () => clock).onServerLog([]), [{ id: 'a' }]);
    clock += 1;
    assert.strictEqual(createChatCopy(storage, () => clock).onServerLog([]), null);
});

test('blocked or corrupt storage leaves no copy and does not throw', () => {
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const copy = createChatCopy(blocked);
    assert.strictEqual(copy.onServerLog([]), null);
    copy.onMessageAdded([{ id: 'a' }]);
    assert.deepStrictEqual(copy.onServerLog([]), [{ id: 'a' }]); // still held in page memory
    assert.strictEqual(createChatCopy({ getItem: () => '{nope', setItem() {} }).onServerLog([]), null);
});

// A third browser, for the account setup() logged in as carol.
function extraBrowser(t, app, cookie) {
    const browser = new Browser(app, cookie);
    t.after(() => browser.close());
    return browser;
}

test('two users holding a shorter history restore it, and a third holding a larger one then adds to it', async (t) => {
    const { app, alice, bob, carol, expected } = await setup(t);
    const third = extraBrowser(t, app, carol);
    third.load();
    await until(() => third.texts()?.length === 2, 'carol to see the chat');
    alice.close();
    bob.close(); // alice and bob keep the two message history
    third.say('carol one');
    third.say('carol two');
    await until(() => third.texts()?.length === 4, 'carol to see her messages');
    const full = third.texts();
    await app.stop();
    third.close();
    await app.start();
    alice.load();
    bob.load();
    await until(async () => (await serverLog(app, carol))?.length, 'the pair to restore the shorter history');
    assert.deepStrictEqual(await serverLog(app, carol), expected);
    third.load(); // arrives afterwards with the larger history
    await until(async () => (await serverLog(app, carol))?.length === 4, 'the larger history to be restored');
    assert.deepStrictEqual(await serverLog(app, carol), full);
    await until(() => alice.texts()?.length === 4 && bob.texts()?.length === 4, 'both pages to show it');
    assert.deepStrictEqual(alice.texts(), full);
    assert.deepStrictEqual(bob.texts(), full);
});

test('a message typed while the server is down does not stop the history coming back', async (t) => {
    const { app, alice, bob, carol, expected } = await setup(t);
    bob.close(); // bob is away until later
    await app.stop();
    await until(() => !alice.page.socket.connected, 'alice to notice the server is down');
    alice.say('typed while down'); // buffered by the browser, sent when it reconnects
    await app.start();
    await until(() => alice.texts()?.includes('typed while down'), 'alice to reconnect and send it');
    await until(async () => (await serverLog(app, carol))?.includes('typed while down'), 'the server to hold it');
    assert.deepStrictEqual(await serverLog(app, carol), ['typed while down']);
    // alice's saved copy is not replaced by the short log the server now shows
    assert.deepStrictEqual(alice.savedTexts(), [...expected, 'typed while down']);
    bob.load();
    await until(async () => (await serverLog(app, carol))?.length === 3, 'the history to be restored behind it');
    const all = [...expected, 'typed while down'];
    assert.deepStrictEqual(await serverLog(app, carol), all);
    await until(() => alice.texts()?.length === 3 && bob.texts()?.length === 3, 'both pages to show it');
    assert.deepStrictEqual(alice.texts(), all);
    assert.deepStrictEqual(bob.texts(), all);
});

test('over 100 messages, more than 1 MB in all, survive a restart with both pages reloading', async (t) => {
    const { app, alice, bob, carol } = await setup(t);
    const filler = 'x'.repeat(4000);
    for (let i = 0; i < 300; i++) (i % 2 ? alice : bob).say(`message ${i} ${filler}`);
    await until(() => alice.texts()?.length === 302 && bob.texts()?.length === 302, 'both pages to see 302 messages', 20000);
    const before = alice.texts();
    assert.ok(JSON.stringify(before).length > 1.2e6, 'the chat should exceed the default 1 MB message limit');
    await app.stop();
    alice.close();
    bob.close();
    await app.start();
    alice.load();
    bob.load();
    await until(async () => (await serverLog(app, carol))?.length === 302, 'all 302 messages to be restored', 20000);
    assert.deepStrictEqual(await serverLog(app, carol), before);
    await until(() => alice.texts()?.length === 302 && bob.texts()?.length === 302, 'both pages to show them');
    assert.deepStrictEqual(alice.texts(), before);
    assert.deepStrictEqual(bob.texts(), before);
});

test('once the restore window has closed a browser adopts the server log instead of its old copy', async (t) => {
    const { app, alice, bob, carol, expected } = await setup(t, { CHAT_RESTORE_WINDOW_MS: '2500' });
    bob.close(); // never comes back in time, so nothing is restored
    await app.stop();
    await app.start();
    await until(() => alice.page.socket.connected && alice.texts() !== null, 'alice to reconnect');
    alice.say('after restart');
    await until(() => alice.texts()?.includes('after restart'), 'alice to see her message');
    // the window is open: the old history is still kept
    assert.deepStrictEqual(alice.savedTexts(), [...expected, 'after restart']);
    await until(() => alice.savedTexts().length === 1, 'alice to adopt the server log', 6000);
    assert.deepStrictEqual(alice.savedTexts(), ['after restart']);
    bob.load(); // too late
    await until(() => bob.texts() !== null, 'bob to connect');
    await sleep(300);
    assert.deepStrictEqual(await serverLog(app, carol), ['after restart']);
    assert.deepStrictEqual(bob.savedTexts(), ['after restart']);
});

const msg = (i, text = `m${i}`) => ({ id: `m${i}`, user: 'A', userId: 'a', text, timestamp: new Date(Date.UTC(2026, 8, 24, 18, 0, i)).toISOString() });
const memoryStorage = (quota = Infinity) => {
    const items = new Map();
    return {
        items,
        getItem: (k) => items.get(k) ?? null,
        setItem: (k, v) => { if (v.length > quota) throw new Error('QuotaExceededError'); items.set(k, v); }
    };
};

test('the saved copy keeps growing, not shrinking, while restoring is open, and follows the server once it is not', () => {
    const storage = memoryStorage();
    const old = [msg(0), msg(1), msg(2)];
    createChatCopy(storage).onMessageAdded(old);
    const copy = createChatCopy(storage); // a reload; restoring is open until the server says otherwise
    copy.onRestoreStatus(true);
    assert.deepStrictEqual(copy.onServerLog([msg(10)]).map((m) => m.id), ['m0', 'm1', 'm2', 'm10']); // offers it back
    const saved = () => JSON.parse(storage.items.get('chat-log-copy')).log.map((m) => m.id);
    assert.deepStrictEqual(saved(), ['m0', 'm1', 'm2', 'm10']);
    copy.onMessageAdded([msg(10), msg(11)]);
    assert.deepStrictEqual(saved(), ['m0', 'm1', 'm2', 'm10', 'm11']);
    copy.onRestoreStatus(false);
    assert.deepStrictEqual(saved(), ['m10', 'm11']);
    copy.onMessageAdded([msg(10), msg(11), msg(12)]);
    assert.deepStrictEqual(saved(), ['m10', 'm11', 'm12']);
    // a reload after settling: the server's log is adopted even when empty
    const later = createChatCopy(storage);
    later.onRestoreStatus(false);
    assert.strictEqual(later.onServerLog([]), null);
    assert.deepStrictEqual(saved(), []);
});

test('a log too big for the browser storage is saved as its most recent messages', () => {
    const storage = memoryStorage(3000);
    const log = Array.from({ length: 60 }, (_, i) => msg(i, 'y'.repeat(100)));
    createChatCopy(storage).onMessageAdded(log);
    const saved = JSON.parse(storage.items.get('chat-log-copy')).log;
    assert.ok(saved.length > 0 && saved.length < 60, `kept ${saved.length}`);
    assert.deepStrictEqual(saved.map((m) => m.id), log.slice(-saved.length).map((m) => m.id));
    assert.ok(storage.items.get('chat-log-copy').length <= 3000);
    // the longest suffix that fits: one more message would not
    const oneMore = JSON.stringify({ savedAt: Date.now(), log: log.slice(-saved.length - 1) });
    assert.ok(oneMore.length > 3000, 'one more message would not have fit');
});

test('an offer is cut to its most recent messages when it would not fit one message', () => {
    const storage = memoryStorage();
    const log = Array.from({ length: 1100 }, (_, i) => msg(i, 'z'.repeat(5000)));
    createChatCopy(storage).onMessageAdded(log);
    const offer = createChatCopy(storage).onServerLog([]);
    assert.ok(offer.length > 900 && offer.length < 1100, `offered ${offer.length}`);
    assert.strictEqual(offer[offer.length - 1].id, 'm1099');
    assert.ok(JSON.stringify(offer).length <= MAX_OFFER_CHARS);
});
