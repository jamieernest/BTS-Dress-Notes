// Runs the real server: a reset keeps the notes it clears (reset-notes.js), the
// config page lists them and can put them back, and restoring twice adds nothing.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

test('reset notes can be listed and restored from the config page, and restoring twice adds nothing', async (t) => {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-notes-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    const alice = new Browser(app, await login(app, oidc, 'alice'));
    const config = Browser.configSocket(app, alice.cookie);
    t.after(async () => {
        alice.close();
        config.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    alice.load();
    await until(() => alice.page.socket.connected && config.connected, 'alice and the config page to connect');
    const list = () => config.timeout(5000).emitWithAck('resets-list');

    assert.deepStrictEqual(await list(), []);
    assert.deepStrictEqual(await config.timeout(5000).emitWithAck('reset-all'), {}, 'resetting nothing keeps nothing');
    assert.deepStrictEqual(await list(), []);

    alice.note('too dark in 3');
    alice.note('follow spot late');
    await until(() => alice.noteTexts().length === 2, 'the notes to arrive');
    const updates = [];
    config.on('resets-update', (l) => updates.push(l));
    assert.deepStrictEqual(await config.timeout(5000).emitWithAck('reset-all'), {});
    await until(() => alice.noteTexts().length === 0, 'the reset to empty the notes');

    const [kept] = await list();
    assert.strictEqual(kept.totalNotes, 2);
    assert.strictEqual(kept.resetBy, 'alice');
    await until(() => updates.length > 0, 'the config page to hear of the kept notes');

    alice.note('new note after the reset');
    await until(() => alice.noteTexts().length === 1, 'a note after the reset');
    assert.deepStrictEqual(await config.timeout(5000).emitWithAck('restore-reset', { id: kept.id }), { restored: 2 });
    await until(() => alice.noteTexts().length === 3, 'the restored notes to arrive');
    assert.deepStrictEqual(alice.noteTexts().sort(), ['follow spot late', 'new note after the reset', 'too dark in 3']);

    assert.deepStrictEqual(await config.timeout(5000).emitWithAck('restore-reset', { id: kept.id }), { restored: 0 }, 'no duplicates');
    assert.deepStrictEqual(await config.timeout(5000).emitWithAck('restore-reset', { id: '../backups' }), { error: 'Those notes are no longer kept.' });
    assert.strictEqual((await list()).length, 1, 'still kept after restoring');
});
