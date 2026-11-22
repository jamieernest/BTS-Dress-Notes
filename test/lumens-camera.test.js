// The camera client against a fake camera HTTP server: login, recall, a reused
// session, re-login after the camera restarts, failure and timeout handling,
// and that credentials stay out of the log and status.
const test = require('node:test');
const assert = require('node:assert');
const { configFromEnv, createCamera, parsePreset, parseHost } = require('../lumens-camera');
const { freePort } = require('./e2e-harness');
const { createFakeCamera } = require('./fake-camera');

const USER = 'cam-user';
const PASS = 'cam-pass-xyz';

async function setup(t, { listening = true, loginBody, timeoutMs = 500, ...envExtra } = {}) {
    const port = await freePort();
    const fake = createFakeCamera({ port, username: USER, password: PASS, loginBody });
    if (listening) await fake.start();
    const logs = [];
    const statuses = [];
    const config = configFromEnv({ CAMERA_HOST: `127.0.0.1:${port}`, CAMERA_USERNAME: USER, CAMERA_PASSWORD: PASS, CAMERA_TIMEOUT_MS: String(timeoutMs), ...envExtra });
    const camera = createCamera({ config, log: (...a) => logs.push(a.join(' ')), onStatus: (s) => statuses.push(s) });
    t.after(() => listening && fake.stop().catch(() => {}));
    return { fake, camera, logs, statuses, port };
}

test('presets are whole numbers from 1, as people count them', () => {
    assert.strictEqual(parsePreset(9), 9);
    assert.strictEqual(parsePreset('9'), 9);
    assert.strictEqual(parsePreset(' 12 '), 12);
    assert.strictEqual(parsePreset(255), 255);
    for (const bad of [0, '0', -1, 256, 9.5, '9.5', 'x', '', null, undefined, {}, NaN]) assert.strictEqual(parsePreset(bad), null, String(bad));
});

test('the feature is off without CAMERA_HOST, and the scene recall needs a preset', () => {
    assert.strictEqual(configFromEnv({}).enabled, false);
    assert.strictEqual(configFromEnv({ CAMERA_USERNAME: 'a', CAMERA_PASSWORD: 'b' }).enabled, false);
    const on = configFromEnv({ CAMERA_HOST: 'http://192.168.1.50/', CAMERA_USERNAME: 'a', CAMERA_PASSWORD: 'b' });
    assert.strictEqual(on.enabled, true);
    assert.strictEqual(on.host, '192.168.1.50');
    assert.strictEqual(on.onScene, false);
    // On needs both the switch and a valid preset; off is the default.
    assert.strictEqual(configFromEnv({ CAMERA_HOST: 'cam', CAMERA_PRESET: '4' }).onScene, false);
    assert.strictEqual(configFromEnv({ CAMERA_HOST: 'cam', CAMERA_RECALL_ON_SCENE: 'on' }).onScene, false);
    const scene = configFromEnv({ CAMERA_HOST: 'cam', CAMERA_PRESET: '4', CAMERA_RECALL_ON_SCENE: 'true' });
    assert.deepStrictEqual([scene.onScene, scene.preset], [true, 4]);
    // The old name is gone, with no alias.
    assert.strictEqual(configFromEnv({ CAMERA_HOST: 'cam', CAMERA_SCENE_PRESET: '4' }).preset, null);
    assert.strictEqual(configFromEnv({ CAMERA_HOST: 'cam', CAMERA_PRESET: '4' }).preset, 4);
    assert.strictEqual(configFromEnv({ CAMERA_PRESET: '4' }).preset, null);
    assert.ok(configFromEnv({ CAMERA_HOST: 'cam', CAMERA_PRESET: 'zero', CAMERA_RECALL_ON_SCENE: '1' }).error);
    assert.strictEqual(parseHost('bad host/path'), null);
    assert.strictEqual(configFromEnv({ CAMERA_HOST: 'bad host/path' }).enabled, false);
});

test('a recall logs in, then recalls with the same uuid and the browser cookies', async (t) => {
    const { fake, camera, statuses } = await setup(t);
    assert.deepStrictEqual(await camera.recall(9), { ok: true });
    assert.deepStrictEqual(fake.requests.map((r) => r.path), ['/cgi-bin/lums_login.cgi', '/cgi-bin/lums_configuration.cgi']);
    const [login, recall] = fake.requests;
    assert.strictEqual(login.method, 'POST');
    assert.strictEqual(login.headers['content-type'], 'application/json');
    assert.strictEqual(login.headers['x-requested-with'], 'XMLHttpRequest');
    assert.strictEqual(login.headers.cookie, 'languAge=en; authority=0; vmsversion=VC-A61PN; vmsversionsub=; userName=; passWord=; uuId=');
    assert.deepStrictEqual(Object.keys(login.body), ['cmd', 'username', 'password', 'uuid']);
    assert.match(login.body.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepStrictEqual(recall.body, { cmd: 'campresetrecall', uuid: login.body.uuid, memnum: '9' });
    assert.strictEqual(recall.headers['x-requested-with'], 'XMLHttpRequest');
    assert.strictEqual(recall.headers.cookie,
        `languAge=en; userName=${USER}; passWord=${PASS}; uuId=${login.body.uuid}; authority=0; vmsversion=VC-A61PN; vmsversionsub=`);
    assert.deepStrictEqual(fake.recalls, ['9']);
    assert.deepStrictEqual([statuses.at(-1).state, statuses.at(-1).preset, statuses.at(-1).error], ['ok', 9, null]);
});

test('the login is reused for later recalls', async (t) => {
    const { fake, camera } = await setup(t);
    await camera.recall(2);
    await camera.recall(3);
    assert.deepStrictEqual(fake.recalls, ['2', '3']);
    assert.strictEqual(fake.requests.filter((r) => r.path.includes('login')).length, 1);
});

test('a rejected session or a restarted camera logs in again once and retries', async (t) => {
    const { fake, camera, logs } = await setup(t);
    await camera.recall(2);
    fake.restart();
    assert.deepStrictEqual(await camera.recall(5), { ok: true });
    assert.deepStrictEqual(fake.recalls, ['2', '5']);
    assert.strictEqual(fake.requests.filter((r) => r.path.includes('login')).length, 2);
    assert.ok(logs.some((l) => /logging in again/.test(l)));
    // Still works afterwards without another login.
    await camera.recall(6);
    assert.strictEqual(fake.requests.filter((r) => r.path.includes('login')).length, 2);
});

test('a wrong login, an error status or no camera is a failed recall with a short reason', async (t) => {
    const wrong = await setup(t, { CAMERA_PASSWORD: 'nope-nope' });
    const bad = await wrong.camera.recall(1);
    assert.deepStrictEqual([bad.ok, bad.error], [false, 'the camera rejected the login']);
    assert.deepStrictEqual([wrong.statuses.at(-1).state, wrong.statuses.at(-1).error], ['failed', 'the camera rejected the login']);
    assert.deepStrictEqual(wrong.fake.recalls, []);

    const broken = await setup(t);
    broken.fake.failStatus = 500;
    const err = await broken.camera.recall(1);
    assert.strictEqual(err.ok, false);
    assert.match(err.error, /HTTP 500/);

    const gone = await setup(t, { listening: false });
    const out = await gone.camera.recall(1);
    assert.deepStrictEqual([out.ok, out.error], [false, 'the camera is not reachable']);
});

test('a camera that never answers fails within the bound', async (t) => {
    const { fake, camera } = await setup(t, { timeoutMs: 300 });
    fake.delayMs = 5000;
    const started = Date.now();
    const out = await camera.recall(1);
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /did not answer in time/);
    assert.ok(Date.now() - started < 1500, 'bounded by the timeout');
});

test('the password never reaches the log or the status, and the login reply is logged', async (t) => {
    const { camera, logs, statuses } = await setup(t, { loginBody: `{"result":"ok","note":"hello ${PASS}"}` });
    await camera.recall(1);
    await setup(t, { CAMERA_PASSWORD: 'wrong-one' }).then((s) => s.camera.recall(1));
    const everything = JSON.stringify([logs, statuses]);
    assert.ok(!everything.includes(PASS));
    assert.ok(!everything.includes('wrong-one'));
    assert.ok(logs.some((l) => /camera said: .*hello \*\*\*/.test(l)), 'what the camera said is logged');
    assert.deepStrictEqual(Object.keys(camera.status()).sort(), ['at', 'configured', 'error', 'preset', 'state']);
});

test('recalls run one at a time, and rapid scene changes collapse into one more recall', async (t) => {
    const { fake, camera } = await setup(t, { CAMERA_PRESET: '7', CAMERA_RECALL_ON_SCENE: 'on' });
    fake.delayMs = 150;
    for (let i = 0; i < 10; i++) camera.sceneChanged();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // One login, then the first recall and a single follow-up for the other nine.
    assert.deepStrictEqual(fake.recalls, ['7', '7']);
    assert.strictEqual(fake.requests.filter((r) => r.path.includes('login')).length, 1);
});

test('scene recall does nothing unless switched on, and never throws when the camera is down', async (t) => {
    const off = await setup(t, { CAMERA_PRESET: '7' });
    off.camera.sceneChanged();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(off.fake.requests.length, 0);

    const down = await setup(t, { listening: false, CAMERA_PRESET: '7', CAMERA_RECALL_ON_SCENE: 'on' });
    down.camera.sceneChanged();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(down.statuses.at(-1).state, 'failed');
});

test('an unconfigured camera does nothing and says so', async () => {
    const camera = createCamera({ config: configFromEnv({}), log: () => {} });
    assert.strictEqual(camera.enabled(), false);
    assert.strictEqual(camera.status().configured, false);
    assert.strictEqual((await camera.recall(1)).ok, false);
    camera.sceneChanged();
});
