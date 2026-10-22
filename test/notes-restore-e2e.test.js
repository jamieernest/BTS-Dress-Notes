// Runs the real server and checks what it does with the notes across a
// restart: the newest good backup under two hours old is loaded, a bad or old
// one is not, and a reset stays reset. See notes-backup.js and server.js.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { backupFilename, MAX_AGE_MS } = require('../notes-backup');
const { sleep, until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

async function setup(t, env) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-restore-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort(), env });
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
    await until(() => alice.page.notes && bob.page.notes && alice.texts() && bob.texts(), 'both browsers to connect');
    return { app, alice, bob, carol };
}

// Stops the app and removes the backup its shutdown wrote, so the test controls what is in the folder.
async function stopWithEmptyBackups(app) {
    await app.stop();
    fs.rmSync(app.backupsDir, { recursive: true, force: true });
}

// Puts a backup file in the app's backups folder, as made `agoMs` ago.
function plantBackup(app, agoMs, content) {
    fs.mkdirSync(app.backupsDir, { recursive: true });
    const name = backupFilename(new Date(Date.now() - agoMs));
    fs.writeFileSync(path.join(app.backupsDir, name), typeof content === 'string' ? content : JSON.stringify(content));
    return name;
}
const note = (id, text) => ({
    id, text, user: 'alice', userId: 'a', timestamp: new Date().toISOString(),
    timecode: { hours: 0, minutes: 0, seconds: 1, frames: 0 }, lxCue: '1', frameRate: 30, tags: [], act: 'Preshow', comments: []
});
const backupOf = (notes, extra = {}) => ({ notes, exportedAt: new Date().toISOString(), totalNotes: notes.length, users: [], ...extra });
const MINUTE = 60 * 1000;

// What the server holds: a fresh user's first notes update on connecting.
function serverNotes(app, cookie) {
    return new Promise((resolve) => {
        const socket = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie }, reconnection: false });
        socket.on('notes-update', (notes) => { socket.close(); resolve(notes.map((n) => n.text)); });
        socket.on('connect_error', () => { socket.close(); resolve(null); });
    });
}
function serverTags(app, cookie) {
    return new Promise((resolve) => {
        const socket = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie }, reconnection: false });
        socket.on('tags-update', (tags) => { socket.close(); resolve(tags.map((t) => t.id)); });
    });
}

test('after a restart the notes come back from the backup written at shutdown', async (t) => {
    const { app, alice, bob, carol } = await setup(t);
    alice.note('first note');
    bob.note('second note');
    await until(() => alice.noteTexts().length === 2, 'both notes to arrive');
    await app.stop();
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), ['first note', 'second note']);
});

test('after a crash the notes come back from the last periodic backup', async (t) => {
    const { app, alice, carol } = await setup(t, { BACKUP_INTERVAL_MS: '200' });
    alice.note('before the crash');
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    await until(() => fs.existsSync(app.backupsDir) && fs.readdirSync(app.backupsDir).some((f) => fs.readFileSync(path.join(app.backupsDir, f), 'utf8').includes('before the crash')),
        'a backup holding the note');
    await app.kill(); // no shutdown backup
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), ['before the crash']);
    await app.kill(); // killed again at once: the restored notes were never lost
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), ['before the crash']);
});

test('the newest backup is used, and its tags with it', async (t) => {
    const { app, carol } = await setup(t);
    await stopWithEmptyBackups(app);
    plantBackup(app, 30 * MINUTE, backupOf([note('old', 'older')]));
    plantBackup(app, 5 * MINUTE, backupOf([note('new', 'newer')], { tags: [{ id: 'only-tag', name: 'Only', color: '#fff' }] }));
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), ['newer']);
    assert.deepStrictEqual(await serverTags(app, carol), ['only-tag']);
});

test('a corrupt newest backup falls back to the one before it', async (t) => {
    const { app, carol } = await setup(t);
    await stopWithEmptyBackups(app);
    plantBackup(app, 20 * MINUTE, backupOf([note('good', 'the good one')]));
    const good = JSON.stringify(backupOf([note('cut', 'cut short')]));
    plantBackup(app, 10 * MINUTE, good.slice(0, good.length - 40));                  // truncated mid-write
    plantBackup(app, 5 * MINUTE, { notes: [{ id: 'x', text: 5 }], totalNotes: 1 });  // wrong shape
    plantBackup(app, 2 * MINUTE, '');                                                // empty file
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), ['the good one']);
});

test('a backup older than two hours is ignored, and so is a server with nothing valid to load', async (t) => {
    const { app, carol } = await setup(t);
    await stopWithEmptyBackups(app);
    plantBackup(app, MAX_AGE_MS + 5 * MINUTE, backupOf([note('stale', 'last night')]));
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), []);
    await stopWithEmptyBackups(app);
    plantBackup(app, 5 * MINUTE, '{ not json');
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), []);
});

test('a crash while a backup is half written leaves the previous one in charge', async (t) => {
    const { app, carol } = await setup(t);
    await stopWithEmptyBackups(app);
    plantBackup(app, 10 * MINUTE, backupOf([note('safe', 'safe note')]));
    // what an interrupted write leaves behind: only ever the temporary file
    fs.writeFileSync(path.join(app.backupsDir, `.${backupFilename()}.123.tmp`), '{"notes":[{"id"');
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), ['safe note']);
});

test('reset empties notes and chat everywhere, and a restart stays empty with no chat restored from a browser', async (t) => {
    const { app, alice, bob, carol } = await setup(t);
    alice.note('a note');
    alice.say('some chat');
    await until(() => bob.noteTexts().length === 1 && bob.texts().length === 1, 'bob to see the note and chat');
    assert.deepStrictEqual(alice.savedTexts(), ['some chat']);

    const config = Browser.configSocket(app, alice.cookie);
    await until(() => new Promise((resolve) => config.on('connect', () => resolve(true))), 'config page to connect');
    config.emit('reset-all');
    await until(() => alice.noteTexts().length === 0 && bob.noteTexts().length === 0, 'notes to empty in both browsers');
    await until(() => alice.texts().length === 0 && bob.texts().length === 0, 'chat to empty in both browsers');
    assert.deepStrictEqual(alice.savedTexts(), [], 'alice drops her saved chat copy');
    assert.deepStrictEqual(bob.savedTexts(), [], 'bob drops his saved chat copy');
    config.close();

    await app.stop();
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), []);
    alice.load();
    bob.load();
    await until(() => alice.texts() && bob.texts(), 'both browsers to reconnect');
    await sleep(300);
    assert.deepStrictEqual(alice.texts(), []);
    assert.deepStrictEqual(bob.texts(), []);
    assert.deepStrictEqual(await serverNotes(app, carol), []);
});

test('a reset stays reset even after a crash, and notes added afterwards survive the next restart', async (t) => {
    const { app, alice, carol } = await setup(t);
    alice.note('gone after reset');
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    const config = Browser.configSocket(app, alice.cookie);
    await until(() => new Promise((resolve) => config.on('connect', () => resolve(true))), 'config page to connect');
    config.emit('reset-all');
    await until(() => alice.noteTexts().length === 0, 'the notes to empty');
    config.close();
    await app.kill();          // no shutdown backup: only the reset's own backup stands
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), []);
    alice.load();
    await until(() => alice.texts(), 'alice to reconnect');
    alice.note('new show note');
    await until(() => alice.noteTexts().length === 1, 'the new note to arrive');
    await app.stop();
    await app.start();
    assert.deepStrictEqual(await serverNotes(app, carol), ['new show note']);
});

test('an overlay cannot reset the server', async (t) => {
    const { app, alice, carol } = await setup(t);
    alice.note('stays');
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    const overlay = io(`http://127.0.0.1:${app.port}`, {
        extraHeaders: { cookie: alice.cookie, referer: `http://127.0.0.1:${app.port}/overlay.html` }, reconnection: false
    });
    await until(() => new Promise((resolve) => overlay.on('connect', () => resolve(true))), 'overlay to connect');
    overlay.emit('reset-all');
    await sleep(300);
    overlay.close();
    assert.deepStrictEqual(await serverNotes(app, carol), ['stays']);
});
