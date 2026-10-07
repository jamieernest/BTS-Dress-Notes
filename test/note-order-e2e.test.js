// A note written while the browser was disconnected arrives late. It must be
// stamped and placed by when it was written (the browser sends its age), not by
// when it reached the server. See public/note-order.js and 'note-submit' in server.js.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { sleep, until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');
const { insertionIndex } = require('../public/note-order');

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-order-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const alice = new Browser(app, await login(app, oidc, 'alice'));
    const bob = new Browser(app, await login(app, oidc, 'bob'));
    const carol = await login(app, oidc, 'carol');
    t.after(async () => {
        alice.close();
        bob.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    alice.load();
    bob.load();
    await until(() => alice.texts() && bob.texts(), 'both browsers to connect');
    return { app, alice, bob, carol };
}

function serverNotes(app, cookie) {
    return new Promise((resolve) => {
        const socket = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie }, reconnection: false });
        socket.on('notes-update', (notes) => { socket.close(); resolve(notes); });
    });
}

test('a note written during an outage lands before a later note that arrived first', async (t) => {
    const { app, alice, bob, carol } = await setup(t);
    const before = Date.now();
    await sleep(400);
    bob.note('written later, delivered first');
    await until(() => alice.noteTexts().length === 1, 'bob\'s note to arrive');
    // alice wrote hers 1.5 s ago while offline, and it only arrives now
    alice.note('written earlier, delivered late', { ageMs: 1500 });
    await until(() => bob.noteTexts().length === 2, 'the late note to arrive');

    const notes = await serverNotes(app, carol);
    assert.deepStrictEqual(notes.map((n) => n.text), ['written earlier, delivered late', 'written later, delivered first']);
    const stamp = Date.parse(notes[0].timestamp);
    const expected = Date.now() - 1500;
    assert.ok(Math.abs(stamp - expected) < 1000, `stamp should be about 1.5 s before arrival, was ${expected - stamp} ms off`);
    assert.ok(stamp > before - 2000);
    // the note-added broadcast carries the stamp the browsers use to place it
    assert.strictEqual(bob.page.notes.find((n) => n.text === 'written earlier, delivered late').timestamp, notes[0].timestamp);
});

test('the timecode the browser captured is kept, and equal stamps keep arrival order', async (t) => {
    const { app, alice, carol } = await setup(t);
    const timecode = { hours: 1, minutes: 2, seconds: 3, frames: 4 };
    alice.note('late', { ageMs: 5000, timecode });
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    const notes = await serverNotes(app, carol);
    assert.deepStrictEqual(notes[0].timecode, timecode);
    assert.deepStrictEqual(insertionIndex([{ timestamp: 'a' }, { timestamp: '2026-01-01T00:00:00.000Z' }, { timestamp: '2026-01-01T00:00:00.000Z' }],
        { timestamp: '2026-01-01T00:00:00.000Z' }), 3);
});

test('a hostile or nonsense age is ignored and the note is stamped on arrival', async (t) => {
    const { app, alice, carol } = await setup(t);
    const bad = [-5000, 'soon', null, NaN, Infinity, 1e15, {}, [1]];
    for (const [i, ageMs] of bad.entries()) alice.note(`bad ${i}`, { ageMs });
    await until(() => alice.noteTexts().length === bad.length, 'the notes to arrive');
    const now = Date.now();
    const notes = await serverNotes(app, carol);
    assert.deepStrictEqual(notes.map((n) => n.text), bad.map((_, i) => `bad ${i}`));
    for (const n of notes) assert.ok(Math.abs(now - Date.parse(n.timestamp)) < 2000, `${n.text} stamped ${now - Date.parse(n.timestamp)} ms ago`);
});

test('a note sent while connected, with no age, is stamped on arrival and appended', async (t) => {
    const { app, alice, carol } = await setup(t);
    alice.note('one');
    alice.note('two');
    await until(() => alice.noteTexts().length === 2, 'the notes to arrive');
    assert.deepStrictEqual((await serverNotes(app, carol)).map((n) => n.text), ['one', 'two']);
});
