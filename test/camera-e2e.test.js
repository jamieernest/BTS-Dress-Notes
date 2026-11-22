// The real server with a fake OBS and a fake camera, driven by real OSC like
// QLab: a start cue with a preset recalls it before OBS records, a failed
// recall never blocks recording or scene labels, scene-change recall fires
// only on a real change, and the page is told the result without credentials.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Message } = require('node-osc');
const { io } = require('socket.io-client');
const { until, freePort, startOidc, createApp, login } = require('./e2e-harness');
const { createFakeObs } = require('./fake-obs');
const { createFakeCamera } = require('./fake-camera');

const USER = 'cam-user';
const PASS = 'cam-pass-xyz';

async function setup(t, { secret = '', camera = 'up', env: extraEnv = {} } = {}) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-e2e-'));
    const videos = path.join(dir, 'Movies');
    fs.mkdirSync(videos);
    const obsPort = await freePort();
    const obs = createFakeObs({ port: obsPort });
    await obs.start();
    const camPort = await freePort();
    const cam = createFakeCamera({ port: camPort, username: USER, password: PASS });
    if (camera === 'up') await cam.start();
    const env = {
        OSC_PORT: String(await freePort()), VIDEOS_DIR: videos, OBS_RETRY_MS: '100', OBS_OSC_SECRET: secret,
        OBS_WEBSOCKET_URL: `ws://127.0.0.1:${obsPort}`, OBS_WEBSOCKET_PASSWORD: '',
        CAMERA_HOST: camera === 'off' ? '' : `127.0.0.1:${camPort}`, CAMERA_USERNAME: USER, CAMERA_PASSWORD: PASS,
        CAMERA_TIMEOUT_MS: '600', CAMERA_SCENE_PRESET: '', CAMERA_RECALL_ON_SCENE: '', ...extraEnv
    };
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort(), env });
    await app.start();
    const cookie = await login(app, oidc, 'alice');
    const seen = { obs: [], camera: [], acts: [] };
    const socket = io(`http://127.0.0.1:${app.port}`, {
        extraHeaders: { cookie, referer: `http://127.0.0.1:${app.port}/config.html` }, reconnection: false
    });
    socket.on('obs-status', (s) => seen.obs.push(s));
    socket.on('camera-status', (s) => seen.camera.push(s));
    socket.on('act-update', (a) => seen.acts.push(a));
    const osc = new Client('127.0.0.1', Number(env.OSC_PORT));
    const send = (address, ...args) => new Promise((resolve, reject) => osc.send(new Message(address, ...args), (e) => (e ? reject(e) : resolve())));
    t.after(async () => {
        socket.close();
        osc.close();
        await app.stop().catch(() => {});
        await obs.stop();
        if (camera === 'up') await cam.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    await until(() => seen.obs.at(-1)?.state === 'idle', 'OBS idle');
    return { app, obs, cam, seen, send };
}

test('with no camera configured the page says so and a preset on the cue changes nothing', async (t) => {
    const { app, obs, cam, seen, send } = await setup(t, { camera: 'off' });
    await until(() => seen.camera.length, 'a camera status');
    assert.strictEqual(seen.camera.at(-1).configured, false);
    await send('/bts/record/start', 9);
    await until(() => obs.active, 'recording');
    assert.strictEqual(cam.requests.length, 0);
    assert.match(app.output(), /the camera is not set up/);
});

test('a start cue with a preset recalls it first, then records; without one only records', async (t) => {
    const { obs, cam, seen, send } = await setup(t);
    cam.delayMs = 250;
    await send('/bts/record/start', 9);
    await until(() => obs.active, 'recording');
    assert.deepStrictEqual(cam.recalls, ['9'], 'the recall finished before OBS was told to record');
    assert.deepStrictEqual(seen.camera.at(-1) && [seen.camera.at(-1).state, seen.camera.at(-1).preset], ['ok', 9]);
    await send('/bts/record/stop');
    await until(() => !obs.active, 'stopped');
    cam.delayMs = 0;
    await send('/bts/record/start');
    await until(() => obs.active, 'recording again');
    assert.deepStrictEqual(cam.recalls, ['9']);
});

test('the secret is checked first, and a preset may follow it', async (t) => {
    const { app, obs, cam, send } = await setup(t, { secret: 'open-sesame' });
    await send('/bts/record/start', 4);
    await until(() => /secret is missing or wrong/.test(app.output()), 'refused');
    assert.strictEqual(cam.requests.length, 0);
    assert.strictEqual(obs.active, false);
    await send('/bts/record/start', 'open-sesame', 4);
    await until(() => obs.active, 'recording');
    assert.deepStrictEqual(cam.recalls, ['4']);
    assert.ok(!app.output().includes('open-sesame'));
});

test('a camera that is down or refuses never blocks recording or scene labels', async (t) => {
    const { app, obs, seen, send } = await setup(t, { camera: 'down' });
    const started = Date.now();
    await send('/bts/record/start', 3);
    await until(() => obs.active, 'recording despite the camera', 3000);
    assert.ok(Date.now() - started < 2500);
    assert.match(app.output(), /could not recall preset 3/);
    assert.match(app.output(), /starting the recording anyway/);
    assert.deepStrictEqual([seen.camera.at(-1).state, seen.camera.at(-1).error], ['failed', 'the camera is not reachable']);
    await send('/bts/scene', 'Act One');
    await until(() => seen.acts.includes('Act One'), 'scene label');
    assert.ok(!JSON.stringify(seen.camera).includes(PASS));
    assert.ok(!app.output().includes(PASS));
});

test('a preset that cannot be one is ignored with a log line, and recording still starts', async (t) => {
    const { app, obs, cam, send } = await setup(t);
    await send('/bts/record/start', 0);
    await until(() => obs.active, 'recording');
    assert.strictEqual(cam.requests.length, 0);
    assert.match(app.output(), /ignored the preset on the start cue/);
});

test('scene recall happens only on a real change, and only when switched on', async (t) => {
    const on = await setup(t, { env: { CAMERA_SCENE_PRESET: '6', CAMERA_RECALL_ON_SCENE: 'on' } });
    await on.send('/bts/scene', 'Act One');
    await until(() => on.cam.recalls.length === 1, 'first recall');
    await on.send('/bts/scene', 'Act One');
    await on.send('/bts/scene', 'Act Two');
    await until(() => on.cam.recalls.length === 2, 'second recall');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepStrictEqual(on.cam.recalls, ['6', '6']);
    assert.deepStrictEqual(on.seen.acts.slice(-2), ['Act One', 'Act Two']);
    // A record cue is not a scene.
    await on.send('/bts/record/start');
    await until(() => on.obs.active, 'recording');
    assert.strictEqual(on.cam.recalls.length, 2);

    const off = await setup(t, { env: { CAMERA_SCENE_PRESET: '6' } });
    await off.send('/bts/scene', 'Act One');
    await until(() => off.seen.acts.includes('Act One'), 'scene');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(off.cam.requests.length, 0);
});

test('a dead camera never delays or breaks a scene update', async (t) => {
    const { seen, send } = await setup(t, { camera: 'down', env: { CAMERA_SCENE_PRESET: '6', CAMERA_RECALL_ON_SCENE: 'on' } });
    await send('/bts/scene', 'Act One');
    await until(() => seen.acts.includes('Act One'), 'scene label');
    await send('/bts/scene', 'Act Two');
    await until(() => seen.acts.includes('Act Two'), 'next scene label');
    await until(() => seen.camera.at(-1)?.state === 'failed', 'the failure shown');
});
