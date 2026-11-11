// Runs the real server and checks that notes are not lost: a malformed message
// cannot crash the server for everyone, a stored note is on disk within
// seconds (so a power cut straight after does not lose it), and only a
// note's or comment's author can change or remove it.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('node-osc');
const { until, sleep, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

async function setup(t, env = {}) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-submit-e2e-'));
    // The once-a-minute safety-net backup is pushed out of the way: only the backup after a change can save the note.
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort(), env: { BACKUP_INTERVAL_MS: '3600000', ...env } });
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
    await until(() => alice.page.socket.connected && bob.page.socket.connected, 'both browsers to connect');
    return { app, alice, bob };
}

const ack = (browser, event, data) => new Promise((resolve) => browser.page.socket.emit(event, data, resolve));

test('a note keeps its starting scene and LX cue when submitted in the next scene', async (t) => {
    const oscPort = await freePort();
    const { alice, bob } = await setup(t, { OSC_PORT: String(oscPort) });
    const osc = new Client('127.0.0.1', oscPort);
    t.after(() => osc.close());
    let scene, cue;
    alice.page.socket.on('act-update', value => { scene = value; });
    alice.page.socket.on('lx-cue-update', value => { cue = value; });
    async function advance(act, lxCue) {
        osc.send('/bts/scene', act);
        osc.send('/eos/out/active/cue/text', `1/${lxCue}`);
        await until(() => scene === act && cue === lxCue, 'scene and cue updates');
    }
    await advance('Song 1', '12');
    const frozen = { act: scene, lxCue: cue };
    await advance('Song 2', '24');
    const payload = { clientId: 'across-scenes', text: 'late entrance', tags: ['lx'], ...frozen };
    const stored = await ack(alice, 'note-submit', payload);
    assert.strictEqual(stored.act, 'Song 1');
    assert.strictEqual(stored.lxCue, '12');
    await until(() => bob.page.notes.some(n => n.id === stored.id), 'the note broadcast');
    assert.strictEqual(bob.page.notes.find(n => n.id === stored.id).act, 'Song 1');

    // An unacknowledged/offline submission keeps the same stamp on a later send.
    const late = await ack(alice, 'note-submit', { ...payload, clientId: 'offline', ageMs: 5000 });
    assert.strictEqual(late.act, 'Song 1');
    assert.strictEqual(late.lxCue, '12');
    await advance('Song 3', '36');
    const resent = await ack(alice, 'note-submit', payload);
    assert.deepStrictEqual(resent, stored);

    // Older clients and malformed stamps retain the live-scene fallback.
    for (const act of [undefined, null, '', '   ', {}, []]) {
        const fallback = await ack(alice, 'note-submit', { text: 'no scene', tags: ['lx'], act });
        assert.strictEqual(fallback.act, 'Song 3');
        assert.strictEqual(fallback.lxCue, '36');
    }
});

test('malformed notes are refused without taking the server down', async (t) => {
    const { alice, bob } = await setup(t);
    alice.page.socket.emit('note-submit', null);
    alice.page.socket.emit('note-submit', 'text');
    alice.page.socket.emit('comment-submit', null);
    alice.page.socket.emit('note-edit-text', null);
    alice.page.socket.emit('create-tag', null);
    assert.deepStrictEqual(await ack(alice, 'note-submit', { clientId: 'c1', text: '   ', tags: ['lx'] }), { error: 'A note needs some text.' });
    assert.deepStrictEqual(await ack(alice, 'note-submit', { clientId: 'c3', text: 'no tag', tags: 'lx' }), { error: 'A note needs at least one tag.' });
    const stored = await ack(alice, 'note-submit', { clientId: 'c2', text: 'focus the gobo', tags: ['lx', {}], timecode: { hours: '<b>' } });
    assert.strictEqual(stored.text, 'focus the gobo');
    assert.deepStrictEqual(stored.tags, ['lx']);
    assert.strictEqual(typeof stored.timecode.hours, 'number');
    await until(() => bob.noteTexts().includes('focus the gobo'), 'bob to get the note');
    assert.strictEqual(bob.page.socket.connected, true);
});

test('two people using the same clientId each keep their own note', async (t) => {
    const { alice, bob } = await setup(t);
    const mine = await ack(alice, 'note-submit', { clientId: 'same', text: 'alice note', tags: ['lx'] });
    const theirs = await ack(bob, 'note-submit', { clientId: 'same', text: 'bob note', tags: ['lx'] });
    assert.notStrictEqual(mine.id, theirs.id);
    assert.strictEqual(theirs.text, 'bob note');
    await until(() => alice.noteTexts().length === 2, 'both notes to arrive');
});

test('a note is backed up within seconds, so killing the server straight after keeps it', async (t) => {
    const { app, alice } = await setup(t);
    await ack(alice, 'note-submit', { clientId: 'c1', text: 'cue 12 late', tags: ['lx'] });
    await sleep(2000);
    await app.kill();
    await app.start();
    alice.load();
    await until(() => alice.page.notes.length > 0, 'the notes to come back');
    assert.deepStrictEqual(alice.noteTexts(), ['cue 12 late']);
});

test('only a comment\'s author can edit or delete it', async (t) => {
    const { alice, bob } = await setup(t);
    const note = await ack(alice, 'note-submit', { clientId: 'c1', text: 'mic 4 crackles', tags: ['lx'] });
    const comments = () => (alice.page.notes.find((n) => n.id === note.id) || {}).comments || [];
    const edited = [];
    alice.page.socket.on('comment-submit', ({ comment }) => comments().push(comment));
    alice.page.socket.on('comment-edit', (e) => edited.push(e.newText));
    bob.page.socket.emit('comment-submit', { noteId: note.id, text: 'swapping it' });
    await until(() => comments().length === 1, 'the comment to arrive');
    const commentId = comments()[0].id;

    alice.page.socket.emit('comment-edit', { noteId: note.id, commentId, newText: 'not bob' });
    alice.page.socket.emit('comment-delete', { noteId: note.id, commentId });
    bob.page.socket.emit('comment-edit', { noteId: note.id, commentId, newText: 'swapped' });
    await until(() => edited.length > 0, 'bob\'s edit');
    assert.deepStrictEqual(edited, ['swapped']);

    const fresh = new Browser(alice.app, alice.cookie);
    t.after(() => fresh.close());
    fresh.load();
    await until(() => fresh.page.notes.length > 0, 'a fresh page to get the notes');
    assert.deepStrictEqual(fresh.page.notes[0].comments.map((c) => c.text), ['swapped']);
});

test('only a note\'s author can delete it, and the deletion survives a restart', async (t) => {
    const { app, alice, bob } = await setup(t);
    const note = await ack(alice, 'note-submit', { clientId: 'c1', text: 'haze too thick', tags: ['lx'] });
    await ack(alice, 'note-submit', { clientId: 'c2', text: 'keep this one', tags: ['lx'] });
    const deleted = [];
    alice.page.socket.on('note-delete', ({ noteId }) => deleted.push(noteId));

    bob.page.socket.emit('note-delete', { noteId: note.id });
    bob.page.socket.emit('note-delete', null);
    alice.page.socket.emit('note-delete', { noteId: note.id });
    await until(() => deleted.length > 0, 'alice\'s delete');
    assert.deepStrictEqual(deleted, [note.id]);

    await sleep(2000);
    await app.kill();
    await app.start();
    const fresh = new Browser(app, alice.cookie);
    t.after(() => fresh.close());
    fresh.load();
    await until(() => fresh.page.notes.length > 0, 'a fresh page to get the notes');
    assert.deepStrictEqual(fresh.noteTexts(), ['keep this one']);
});
