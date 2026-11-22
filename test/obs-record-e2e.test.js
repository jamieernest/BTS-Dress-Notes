// Runs the real server against a fake OBS (test/fake-obs.js) and sends real
// OSC over UDP like QLab: the recording cues start and stop OBS, never become
// scene labels, honour the optional secret, show the state to every page, and
// what OBS saves in the videos folder turns up in the live recording.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Message } = require('node-osc');
const { io } = require('socket.io-client');
const { backupFilename } = require('../notes-backup');
const { until, freePort, startOidc, createApp, login } = require('./e2e-harness');
const { createFakeObs } = require('./fake-obs');
const { makeMp4 } = require('./video-fixtures');

async function setup(t, { obs: withObs = true, password = '', secret, clientPassword = password, beforeStart, fakeListening = true } = {}) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-record-e2e-'));
    const videos = path.join(dir, 'Movies');
    fs.mkdirSync(videos);
    const obsPort = await freePort();
    const fake = createFakeObs({ port: obsPort, password });
    if (fakeListening) await fake.start();
    const oscPort = await freePort();
    const env = { OSC_PORT: String(oscPort), VIDEOS_DIR: videos, OBS_SCAN_MS: '200', OBS_RETRY_MS: '100' };
    if (withObs) {
        env.OBS_WEBSOCKET_URL = `ws://127.0.0.1:${obsPort}`;
        if (clientPassword) env.OBS_WEBSOCKET_PASSWORD = clientPassword;
    } else {
        env.OBS_WEBSOCKET_URL = '';
        env.OBS_WEBSOCKET_PASSWORD = '';
    }
    env.OBS_OSC_SECRET = secret || '';
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort(), env });
    if (beforeStart) await beforeStart({ app, videos, dir });
    await app.start();
    const cookie = await login(app, oidc, 'alice');

    // A page's socket: what it is told about OBS and the scene.
    const sockets = [];
    const watch = (page) => {
        const seen = { statuses: [], acts: [], recordings: [] };
        const socket = io(`http://127.0.0.1:${app.port}`, {
            extraHeaders: { cookie, referer: `http://127.0.0.1:${app.port}/${page}` }, reconnection: false
        });
        socket.on('obs-status', (s) => seen.statuses.push(s));
        socket.on('act-update', (a) => seen.acts.push(a));
        socket.on('recordings-update', (r) => seen.recordings.push(r));
        sockets.push(socket);
        seen.last = () => seen.statuses[seen.statuses.length - 1];
        return seen;
    };
    const osc = new Client('127.0.0.1', oscPort);
    const send = (address, ...args) => new Promise((resolve, reject) => osc.send(new Message(address, ...args), (e) => (e ? reject(e) : resolve())));
    t.after(async () => {
        sockets.forEach((s) => s.close());
        osc.close();
        await app.stop().catch(() => {});
        await fake.stop();
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const get = (url) => fetch(`http://127.0.0.1:${app.port}${url}`, { headers: { cookie } });
    return { app, fake, videos, dir, cookie, watch, send, get };
}

const NAME = '2026-11-22 19-30-00.mp4';

test('with OBS not set up the cues are ignored, say so, and the app is unchanged', async (t) => {
    const { app, watch, send } = await setup(t, { obs: false });
    const seen = watch('index.html');
    await until(() => seen.statuses.length, 'a status');
    assert.strictEqual(seen.last().enabled, false);
    await send('/bts/record/start');
    await until(() => /ignored OSC \/bts\/record\/start: OBS recording is not set up/.test(app.output()), 'the ignored line');
    assert.ok(!/OBS recording is on/.test(app.output()));
    // Scene labels still work.
    await send('/bts/scene', 'Act One');
    await until(() => seen.acts.includes('Act One'), 'the scene label');
});

test('start and stop cues drive OBS, and never become scene labels', async (t) => {
    const { fake, watch, send } = await setup(t);
    const seen = watch('index.html');
    await until(() => seen.last()?.state === 'idle', 'OBS connected and idle');

    await send('/bts/scene', 'Act One');
    await until(() => seen.acts.includes('Act One'), 'a scene label');
    const actsBefore = seen.acts.length;

    await send('/bts/record/start');
    await until(() => seen.last().state === 'recording', 'recording state on the page');
    assert.strictEqual(fake.active, true);
    // A value on the cue is still not a scene label.
    await send('/bts/record/stop', 'Act Two');
    await until(() => seen.last().state === 'idle', 'idle again');
    assert.strictEqual(fake.active, false);
    await send('/bts/record/other', 'Act Three');
    await send('/bts/record', 'Act Four');
    await send('/bts/scene', 'Act Five');
    await until(() => seen.acts.includes('Act Five'), 'the next scene label');
    assert.deepStrictEqual(seen.acts.slice(actsBefore), ['Act Five']);
});

test('starting twice and stopping while idle do nothing, and are logged as such', async (t) => {
    const { app, fake, watch, send } = await setup(t);
    const seen = watch('index.html');
    await until(() => seen.last()?.state === 'idle', 'idle');
    await send('/bts/record/stop');
    await until(() => /not recording, nothing to do/.test(app.output()), 'idle stop is a no-op');
    await send('/bts/record/start');
    await until(() => seen.last().state === 'recording', 'recording');
    await send('/bts/record/start');
    await until(() => /already recording, nothing to do/.test(app.output()), 'second start is a no-op');
    assert.strictEqual(fake.active, true);
    assert.strictEqual(seen.last().state, 'recording');
});

test('with a secret set the cue must carry it, and the secret is never logged', async (t) => {
    const { app, fake, watch, send } = await setup(t, { secret: 'open-sesame' });
    const seen = watch('index.html');
    await until(() => seen.last()?.state === 'idle', 'idle');

    await send('/bts/record/start');
    await send('/bts/record/start', 'nope-token');
    await until(() => (app.output().match(/the secret is missing or wrong/g) || []).length === 2, 'both refused and logged');
    assert.strictEqual(fake.active, false);

    await send('/bts/record/start', 'open-sesame');
    await until(() => seen.last().state === 'recording', 'started with the secret');
    await send('/bts/record/stop');
    await until(() => (app.output().match(/the secret is missing or wrong/g) || []).length === 3, 'a stop without it is refused');
    assert.strictEqual(fake.active, true);
    await send('/bts/record/stop', 'open-sesame');
    await until(() => seen.last().state === 'idle', 'stopped with the secret');
    assert.ok(!app.output().includes('open-sesame'));
    assert.ok(!app.output().includes('nope-token'));
});

test('the state follows OBS when someone records by hand, on the config page too', async (t) => {
    const { fake, watch } = await setup(t);
    const config = watch('config.html');
    const main = watch('index.html');
    await until(() => config.last()?.state === 'idle' && main.last()?.state === 'idle', 'both idle');
    fake.setRecording(true);
    await until(() => config.last().state === 'recording' && main.last().state === 'recording', 'both recording');
    fake.setRecording(false, null);
    await until(() => config.last().state === 'idle' && main.last().state === 'idle', 'both idle again');
});

test('a wrong password or absent OBS is an error state, and nothing else is affected', async (t) => {
    const wrong = await setup(t, { password: 'right', clientPassword: 'wrong' });
    const seen = wrong.watch('index.html');
    await until(() => seen.last()?.state === 'error', 'an error state');
    assert.strictEqual(seen.last().error, 'OBS rejected the password');
    assert.ok(!JSON.stringify(seen.statuses).includes('wrong'));
    await wrong.send('/bts/record/start');
    await until(() => /could not start recording/.test(wrong.app.output()), 'the failure is logged');
    assert.strictEqual(wrong.fake.active, false);
    await wrong.send('/bts/scene', 'Act One');
    await until(() => seen.acts.includes('Act One'), 'scene labels still arrive');

    const absent = await setup(t, { fakeListening: false });
    const gone = absent.watch('config.html');
    await until(() => gone.last()?.state === 'error', 'an error state');
    assert.strictEqual(gone.last().error, 'OBS is not reachable');
    await absent.send('/bts/record/stop');
    await absent.send('/bts/scene', 'Act Two');
    await until(() => gone.acts.includes('Act Two'), 'scene labels still arrive');
    await absent.fake.start();
    await until(() => gone.last().state === 'idle', 'connects once OBS is up');
});

test('a recording OBS finishes appears in the live recording, ready to play', async (t) => {
    const { fake, videos, watch, send, get } = await setup(t);
    const seen = watch('index.html');
    await until(() => seen.last()?.state === 'idle', 'idle');
    const file = path.join(videos, NAME);
    fs.writeFileSync(file, makeMp4({ durationS: 5 }));
    fake.recordTo = file;

    await send('/bts/record/start');
    await until(() => seen.last().state === 'recording', 'recording');
    await send('/bts/record/stop');
    await until(() => seen.recordings.some((r) => r.collection === 'live' && r.recordings.length === 1), 'the recording update');
    const [part] = seen.recordings.at(-1).recordings;
    assert.strictEqual(part.name, NAME);
    assert.strictEqual(part.uploadedBy, 'OBS');
    assert.strictEqual(part.duration, 5);

    const list = await (await get('/recordings/live')).json();
    assert.strictEqual(list.recordings.length, 1);
    const video = await get(part.url);
    assert.strictEqual(video.status, 200);
    assert.strictEqual(video.headers.get('content-type'), 'video/mp4');
    assert.deepStrictEqual(Buffer.from(await video.arrayBuffer()), fs.readFileSync(file));
    assert.strictEqual(seen.last().notice, null);

    // Recording again to the same name is not added twice, and the scan does not re-add it.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.strictEqual((await (await get('/recordings/live')).json()).recordings.length, 1);
});

test('a recording OBS saved as MKV is reported as unplayable, not added', async (t) => {
    const { app, fake, videos, watch, get } = await setup(t);
    const seen = watch('config.html');
    await until(() => seen.last()?.state === 'idle', 'idle');
    const file = path.join(videos, '2026-11-22 19-30-00.mkv');
    fs.writeFileSync(file, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]));
    fake.recordTo = file;
    fake.setRecording(true);
    await until(() => seen.last().state === 'recording', 'recording');
    fake.setRecording(false);
    await until(() => seen.last().notice, 'a notice about the file');
    assert.match(seen.last().notice.text, /\.mkv/);
    assert.match(seen.last().notice.text, /MP4/);
    assert.match(app.output(), /browsers cannot play/);
    assert.strictEqual((await (await get('/recordings/live')).json()).recordings.length, 0);
    // The next recording starting clears it.
    fake.setRecording(true);
    await until(() => seen.last().state === 'recording' && !seen.last().notice, 'notice cleared');
});

test('a path OBS reports outside the videos folder is refused and logged', async (t) => {
    const { app, fake, dir, watch, get } = await setup(t);
    const seen = watch('config.html');
    await until(() => seen.last()?.state === 'idle', 'idle');
    const outside = path.join(dir, 'elsewhere.mp4');
    fs.writeFileSync(outside, makeMp4({ durationS: 5 }));
    fake.recordTo = outside;
    fake.setRecording(true);
    await until(() => seen.last().state === 'recording', 'recording');
    fake.setRecording(false);
    await until(() => seen.last().notice, 'a notice');
    assert.match(seen.last().notice.text, /outside the videos folder/);
    assert.match(app.output(), /outside the videos folder/);
    assert.strictEqual((await (await get('/recordings/live')).json()).recordings.length, 0);
});

test('a recording OBS finished while the server was down is picked up from the folder', async (t) => {
    const now = Date.now();
    const { videos, get } = await setup(t, {
        beforeStart: ({ app, videos: dir }) => {
            // The show's notes are restored, so the folder is checked from when they began.
            fs.mkdirSync(app.backupsDir, { recursive: true });
            const note = {
                id: 'n1', text: 'hello', user: 'alice', userId: 'a', timestamp: new Date(now - 5 * 60000).toISOString(),
                timecode: { hours: 0, minutes: 0, seconds: 1, frames: 0 }, lxCue: '1', frameRate: 30, tags: [], act: 'Preshow', comments: []
            };
            fs.writeFileSync(path.join(app.backupsDir, backupFilename(new Date(now - 60000))), JSON.stringify({
                notes: [note], exportedAt: new Date(now).toISOString(), totalNotes: 1, users: []
            }));
            const during = path.join(dir, NAME);
            const before = path.join(dir, '2026-11-21 10-00-00.mp4');
            const unrelated = path.join(dir, 'holiday.mp4');
            for (const [file, ago] of [[during, 90], [before, 3 * 3600], [unrelated, 90]]) {
                fs.writeFileSync(file, makeMp4({ durationS: 30 }));
                fs.utimesSync(file, new Date(now - ago * 1000), new Date(now - ago * 1000));
            }
        }
    });
    await until(async () => (await (await get('/recordings/live')).json()).recordings.length === 1, 'the pickup');
    const list = (await (await get('/recordings/live')).json()).recordings;
    assert.deepStrictEqual(list.map((r) => r.name), [NAME]);
    assert.strictEqual(list[0].uploadedBy, 'OBS');
    assert.ok(fs.existsSync(path.join(videos, NAME)));
});
