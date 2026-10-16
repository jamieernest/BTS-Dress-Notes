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

test('a note cannot have its last tag taken off', async (t) => {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-author-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const alice = new Browser(app, await login(app, oidc, 'alice'));
    t.after(async () => {
        alice.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    alice.load();
    const updates = [];
    alice.page.socket.on('note-update-tags', (u) => updates.push(u));
    await until(() => alice.page.socket.connected, 'the browser to connect');

    alice.note('tagged', { tags: ['lighting'] });
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    const noteId = alice.page.notes[0].id;

    alice.page.socket.emit('note-update-tags', { noteId, tags: [] });
    await until(() => updates.length === 1, 'the server to answer');
    assert.deepStrictEqual(updates[0].tags, ['lighting'], 'the sender is told the tag is still there');

    alice.page.socket.emit('note-update-tags', { noteId, tags: ['sound'] });
    await until(() => updates.length === 2, 'the swap to be broadcast');
    assert.deepStrictEqual(updates[1].tags, ['sound']);
});

// Ownership is the Keycloak identity, so it has to survive a backup, a restart and a display-name change.
const { io } = require('socket.io-client');
const { backupFilename } = require('../notes-backup');

test('authorship is written to the backup by identity and still decides who can edit after a restart', async (t) => {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-author-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const aliceCookie = await login(app, oidc, 'alice');
    const bobCookie = await login(app, oidc, 'bob');
    const alice = new Browser(app, aliceCookie);
    t.after(async () => {
        alice.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    alice.load();
    await until(() => alice.page.socket.connected, 'alice to connect');
    alice.note('alice wrote this');
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    const sub = alice.page.notes[0].userId;
    await app.stop();

    const [file] = fs.readdirSync(app.backupsDir).filter((f) => f.startsWith('backup-')).sort().reverse();
    const written = JSON.parse(fs.readFileSync(path.join(app.backupsDir, file), 'utf8'));
    assert.strictEqual(written.notes[0].userId, sub);
    assert.deepStrictEqual(written.authors, [{ userId: sub, name: 'alice' }]);

    // the stored display name is only a label: change it and ownership still follows the identity
    written.authors[0].name = 'Alice Renamed';
    fs.writeFileSync(path.join(app.backupsDir, file), JSON.stringify(written));
    await app.start();

    const connect = (cookie) => new Promise((resolve) => {
        const socket = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie }, reconnection: false });
        socket.notes = null;
        socket.on('notes-update', (notes) => { socket.notes = notes; resolve(socket); });
    });
    const bob = await connect(bobCookie);
    const again = await connect(await login(app, oidc, 'alice'));
    t.after(() => { bob.close(); again.close(); });
    assert.strictEqual(bob.notes[0].userId, sub);
    assert.strictEqual(bob.notes[0].user, 'Alice Renamed');

    const edits = [];
    bob.on('note-edit-text', (e) => edits.push(e));
    bob.emit('note-edit-text', { noteId: bob.notes[0].id, newText: 'hijacked' });
    await sleep(400);
    assert.strictEqual(edits.length, 0, 'bob still cannot edit after the restore');
    again.emit('note-edit-text', { noteId: bob.notes[0].id, newText: 'alice edits' });
    await until(() => edits.length === 1, 'the author edit after the restore');
});

test('an older backup without author data restores cleanly and its notes stay editable by anyone', async (t) => {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-author-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const bobCookie = await login(app, oidc, 'bob');
    t.after(async () => {
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    await app.stop();
    fs.rmSync(app.backupsDir, { recursive: true, force: true });
    fs.mkdirSync(app.backupsDir, { recursive: true });
    const old = { id: 'old1', text: 'from before authors', user: 'someone', timestamp: new Date().toISOString(), tags: [], comments: [] };
    fs.writeFileSync(path.join(app.backupsDir, backupFilename()), JSON.stringify({ notes: [old], totalNotes: 1, users: [] }));
    await app.start();

    const bob = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie: bobCookie }, reconnection: false });
    t.after(() => bob.close());
    const edit = new Promise((resolve) => bob.on('note-edit-text', resolve));
    await until(() => bob.connected, 'bob to connect');
    bob.emit('note-edit-text', { noteId: 'old1', newText: 'bob can edit' });
    assert.strictEqual((await edit).newText, 'bob can edit');
});

test('a backup whose notes carry a legacy socket id as userId restores them editable by anyone', async (t) => {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-author-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const bobCookie = await login(app, oidc, 'bob');
    t.after(async () => {
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    await app.stop();
    fs.rmSync(app.backupsDir, { recursive: true, force: true });
    fs.mkdirSync(app.backupsDir, { recursive: true });
    const old = { id: 'old2', text: 'from a socket', user: 'someone', userId: 'AbCdEf123_socketid', timestamp: new Date().toISOString(), tags: [], comments: [] };
    fs.writeFileSync(path.join(app.backupsDir, backupFilename()), JSON.stringify({ notes: [old], totalNotes: 1, users: [] }));
    await app.start();

    const bob = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie: bobCookie }, reconnection: false });
    t.after(() => bob.close());
    const edit = new Promise((resolve) => bob.on('note-edit-text', resolve));
    await until(() => bob.connected, 'bob to connect');
    bob.emit('note-edit-text', { noteId: 'old2', newText: 'bob can edit' });
    assert.strictEqual((await edit).newText, 'bob can edit');
});

async function importSetup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-author-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const sockets = [];
    t.after(async () => {
        sockets.forEach((s) => s.close());
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const connect = async (name) => {
        const socket = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie: await login(app, oidc, name) }, reconnection: false });
        sockets.push(socket);
        socket.notes = [];
        socket.on('notes-update', (notes) => { socket.notes = notes; });
        socket.on('note-added', (note) => { socket.notes = [...socket.notes, note]; });
        await until(() => socket.connected, `${name} to connect`);
        return socket;
    };
    return { connect };
}

const importFile = async (socket, file) => {
    const done = new Promise((resolve) => socket.once('import-success', resolve));
    socket.emit('import-backup', file);
    await done;
};

test('importing a file without authors leaves its notes editable by anyone', async (t) => {
    const { connect } = await importSetup(t);
    const bob = await connect('bob');
    const legacy = { id: 'imp1', text: 'legacy', user: 'x', userId: 'socketid123', timestamp: new Date().toISOString(), tags: [], comments: [] };
    await importFile(bob, { notes: [legacy] });
    const edit = new Promise((resolve) => bob.once('note-edit-text', resolve));
    bob.emit('note-edit-text', { noteId: 'imp1', newText: 'bob edited' });
    assert.strictEqual((await edit).newText, 'bob edited');
});

test('an import that has to skip unreadable notes says how many', async (t) => {
    const { connect } = await importSetup(t);
    const bob = await connect('bob');
    const note = (id) => ({ id, text: 'n', user: 'x', timestamp: new Date().toISOString(), tags: [], comments: [] });
    const done = new Promise((resolve) => bob.once('import-success', resolve));
    bob.emit('import-backup', { notes: [note('ok1'), note('x'.repeat(200))] });
    assert.strictEqual(await done, 'Backup imported, but 1 of 2 notes could not be read and were skipped.');
    await until(() => bob.notes.length === 1, 'the readable note to arrive');
});

test('an exported file keeps authorship by Keycloak identity when imported again', async (t) => {
    const { connect } = await importSetup(t);
    const alice = await connect('alice');
    const bob = await connect('bob');
    alice.emit('note-submit', { id: 'rt1', clientId: 'c1', text: 'alice note', timestamp: new Date().toISOString(), tags: ['lx'], comments: [] });
    await until(() => alice.notes.length === 1, 'the note to arrive');
    const exported = new Promise((resolve) => alice.once('export-data', resolve));
    alice.emit('export-request', 'json');
    const file = JSON.parse((await exported).data);
    assert.deepStrictEqual(file.authors.map((a) => a.userId), [alice.notes[0].userId]);

    await importFile(bob, file);
    const edits = [];
    bob.on('note-edit-text', (e) => edits.push(e));
    bob.emit('note-edit-text', { noteId: alice.notes[0].id, newText: 'hijacked' });
    await sleep(400);
    assert.strictEqual(edits.length, 0, 'bob cannot edit the imported note');
    alice.emit('note-edit-text', { noteId: alice.notes[0].id, newText: 'mine' });
    await until(() => edits.length === 1, 'the author edit after import');
});
