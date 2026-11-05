// Runs the real server: a recording uploaded for the live notes is listed,
// streamed (with ranges), retimed and removed by anyone logged in, goes with
// the notes when the show is saved, and leaves the live notes on a reset.
// See recordings.js and server.js.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordings-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort(), env: { RECORDING_MAX_BYTES: '1000' } });
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
    const updates = [];
    alice.page.socket.on('recordings-update', (update) => updates.push(update));
    return { app, alice, config, updates };
}

const at = (app, url) => `http://127.0.0.1:${app.port}${url}`;
const START = Date.parse('2026-10-07T19:30:00Z');

function upload(app, cookie, collection, body, query) {
    return fetch(at(app, `/recordings/${collection}?${new URLSearchParams(query)}`), {
        method: 'POST', headers: { 'content-type': 'video/mp4', ...(cookie ? { cookie } : {}) }, body
    });
}

test('a recording uploaded for the live notes is shared, streamed, retimed and removed', async (t) => {
    const { app, alice, updates } = await setup(t);
    const cookie = alice.cookie;
    const query = { name: 'Show.2026-10-07 19-30-00.mp4', duration: '12.5', startAt: String(START) };
    assert.strictEqual((await upload(app, null, 'live', 'video', query)).status, 401);
    assert.strictEqual((await fetch(at(app, '/recordings/live'))).status, 401);
    assert.strictEqual((await upload(app, cookie, 'live', 'video', { ...query, name: 'notes.json' })).status, 400);
    assert.strictEqual((await upload(app, cookie, 'nope', 'video', query)).status, 404);
    assert.strictEqual((await upload(app, cookie, 'live', 'x'.repeat(2000), query)).status, 413);

    const response = await upload(app, cookie, 'live', '0123456789', query);
    assert.strictEqual(response.status, 201);
    const part = await response.json();
    assert.deepStrictEqual([part.name, part.size, part.duration, part.startAt, part.uploadedBy, part.url],
        [query.name, 10, 12.5, new Date(START).toISOString(), 'alice', `/recordings/live/${part.id}`]);
    await until(() => updates.some(u => u.collection === 'live' && u.recordings.length === 1), 'everyone to hear of it');

    const list = await (await fetch(at(app, '/recordings/live'), { headers: { cookie } })).json();
    assert.deepStrictEqual(list.recordings.map(p => p.id), [part.id]);
    const range = await fetch(at(app, part.url), { headers: { cookie, range: 'bytes=2-5' } });
    assert.strictEqual(range.status, 206);
    assert.strictEqual(range.headers.get('content-type'), 'video/mp4');
    assert.strictEqual(await range.text(), '2345');
    assert.strictEqual((await fetch(at(app, part.url))).status, 401);

    const patch = (body) => fetch(at(app, part.url), { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.strictEqual((await patch({ startAt: 'later' })).status, 400);
    const moved = await (await patch({ startAt: START + 4000 })).json();
    assert.strictEqual(moved.startAt, new Date(START + 4000).toISOString());

    const elsewhere = await fetch(at(app, part.url), { method: 'DELETE', headers: { cookie, origin: 'http://evil.example' } });
    assert.strictEqual(elsewhere.status, 403);
    assert.strictEqual((await fetch(at(app, part.url), { method: 'DELETE', headers: { cookie } })).status, 204);
    assert.strictEqual((await fetch(at(app, part.url), { headers: { cookie } })).status, 404);
    await until(() => updates.at(-1).recordings.length === 0, 'everyone to hear it was removed');
});

test('saving the show keeps its recording; the reset removes the live one', async (t) => {
    const { app, alice, config } = await setup(t);
    const cookie = alice.cookie;
    alice.note('too dark in 3');
    await until(() => alice.noteTexts().length === 1, 'the note to arrive');
    for (const name of ['Show.2026-10-07 19-30-00.mp4', 'Show.2026-10-07 20-15-00.mp4']) {
        assert.strictEqual((await upload(app, cookie, 'live', 'video', { name, duration: '60' })).status, 201);
    }
    const saved = await config.timeout(5000).emitWithAck('save-show', { name: 'Dress', reset: true });
    assert.strictEqual(saved.show.recordingParts, 2);
    await until(() => alice.noteTexts().length === 0, 'the reset');

    const live = await (await fetch(at(app, '/recordings/live'), { headers: { cookie } })).json();
    assert.deepStrictEqual(live.recordings, []);
    const kept = await (await fetch(at(app, `/recordings/${saved.show.id}`), { headers: { cookie } })).json();
    assert.deepStrictEqual(kept.recordings.map(p => p.name), ['Show.2026-10-07 19-30-00.mp4', 'Show.2026-10-07 20-15-00.mp4']);
    assert.strictEqual(await (await fetch(at(app, kept.recordings[0].url), { headers: { cookie } })).text(), 'video');
    const shows = await (await fetch(at(app, '/shows'), { headers: { cookie, accept: 'application/json' } })).json();
    assert.strictEqual(shows[0].recordingParts, 2);
});
