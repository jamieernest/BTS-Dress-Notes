// Editing a note is for its author only; the server enforces it, whatever the page shows.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { sleep, until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

test('another user cannot edit a note by sending the message directly', async (t) => {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-author-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
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
    const edits = [];
    bob.page.socket.on('note-edit-text', (e) => edits.push(e));
    await until(() => alice.page.socket.connected && bob.page.socket.connected, 'both browsers to connect');

    alice.note('original');
    await until(() => bob.noteTexts().length === 1, 'the note to arrive');
    const note = bob.page.notes[0];
    assert.ok(note.userId, 'the note records its author');

    bob.page.socket.emit('note-edit-text', { noteId: note.id, newText: 'hijacked' });
    await sleep(400);
    assert.strictEqual(edits.length, 0, 'the rejected edit is not broadcast');

    alice.page.socket.emit('note-edit-text', { noteId: note.id, newText: 'fixed by alice' });
    await until(() => edits.length === 1, 'the author\'s edit to be broadcast');
    assert.strictEqual(edits[0].newText, 'fixed by alice');
    assert.strictEqual(edits[0].lastEditedBy, 'alice');
});
