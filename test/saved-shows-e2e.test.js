// Runs the real server: notes saved under a name from the config page, with or
// without the reset, can be listed and opened over HTTP (Past notes), and only
// by someone logged in. See saved-shows.js and server.js.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-shows-e2e-'));
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
    return { app, alice, config };
}

const save = (config, data) => config.timeout(5000).emitWithAck('save-show', data);
const get = (app, url, cookie) => fetch(`http://127.0.0.1:${app.port}${url}`, { headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) } });

test('live playback is authenticated and saved shows keep recording times and the show log', async (t) => {
    const { app, alice, config } = await setup(t);
    assert.equal((await get(app, '/playback/live')).status, 401);
    const startedAt = new Date(Date.now() - 5000).toISOString();
    const log = [{ type: 'scene', value: 'Opening', at: startedAt }, { type: 'cue', value: '1/5 Front', at: startedAt }];
    alice.page.socket.emit('import-backup', {
        notes: [{ id: 'playback-note', user: 'Alice', text: 'Spot arrives early', timestamp: new Date().toISOString(), startedAt, tags: ['lx'], timecode: { hours: 1, minutes: 0, seconds: 5, frames: 0 } }],
        tags: [{ id: 'lx', name: 'Lighting', color: '#00b4d8' }], showLog: log
    });
    await until(() => alice.noteTexts().includes('Spot arrives early'), 'the notes import');
    const response = await get(app, '/playback/live', alice.cookie);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const live = await response.json();
    assert.equal(live.notes[0].startedAt, startedAt);
    assert.deepEqual(live.showLog, log);
    const saved = await save(config, { name: 'Playback test' });
    const show = await (await get(app, `/shows/${saved.show.id}`, alice.cookie)).json();
    assert.equal(show.notes[0].startedAt, startedAt);
    assert.deepEqual(show.showLog, log);
    assert.deepEqual((await (await get(app, '/playback/live', alice.cookie)).json()).notes, live.notes);
});

test('a show saved with a name is listed and opens with its notes; save and reset then empties the live notes', async (t) => {
    const { app, alice, config } = await setup(t);
    assert.deepStrictEqual(await save(config, { name: 'Tech' }), { error: 'There are no notes to save.' });
    alice.note('too dark in 3');
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    assert.deepStrictEqual(await save(config, { name: '   ' }), { error: 'Give the show a name first.' });

    const kept = await save(config, { name: 'BUSMS Overture Tech 2026' });
    assert.strictEqual(kept.show.totalNotes, 1);
    assert.deepStrictEqual(alice.noteTexts(), ['too dark in 3'], 'a plain save leaves the notes');

    alice.note('follow spot late');
    await until(() => alice.noteTexts().length === 2, 'the second note to arrive');
    const dress = await save(config, { name: 'BUSMS Overture Dress Notes 2026', reset: true });
    assert.strictEqual(dress.show.totalNotes, 2);
    await until(() => alice.noteTexts().length === 0, 'the reset to empty the notes');

    const list = await (await get(app, '/shows', alice.cookie)).json();
    assert.deepStrictEqual(list.map(s => s.name), ['BUSMS Overture Dress Notes 2026', 'BUSMS Overture Tech 2026']);
    const show = await (await get(app, `/shows/${encodeURIComponent(dress.show.id)}`, alice.cookie)).json();
    assert.deepStrictEqual(show.notes.map(n => n.text), ['too dark in 3', 'follow spot late']);
    assert.ok(Array.isArray(show.tags) && show.tags.length > 0, 'the tags go with it');

    assert.strictEqual((await get(app, '/shows/nope', alice.cookie)).status, 404);
    assert.strictEqual((await get(app, '/shows/..%2Fsessions', alice.cookie)).status, 404);
    assert.strictEqual((await get(app, '/shows')).status, 401, 'not without a login');
    assert.strictEqual((await get(app, `/shows/${dress.show.id}`)).status, 401);
});
