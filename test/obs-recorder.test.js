// obs-recorder.js against a fake OBS WebSocket server (test/fake-obs.js): it
// starts and stops recording, follows OBS's own state (including recordings
// started by hand), reports a wrong password or an absent OBS as a state, and
// reconnects after OBS restarts, without ever throwing into the caller.
const test = require('node:test');
const assert = require('node:assert');
const { until, freePort } = require('./e2e-harness');
const { createFakeObs } = require('./fake-obs');
const { configFromEnv, createRecorder } = require('../obs-recorder');

async function setup(t, { password = '', clientPassword = password, listen = true, ...options } = {}) {
    const port = await freePort();
    const fake = createFakeObs({ port, password });
    if (listen) await fake.start();
    const finished = [];
    const states = [];
    const logs = [];
    const recorder = createRecorder({
        url: `ws://127.0.0.1:${port}`, password: clientPassword, retryMs: 40, maxRetryMs: 80, connectTimeoutMs: 1000, requestTimeoutMs: 400,
        log: (...args) => logs.push(args.join(' ')),
        onStatus: (s) => states.push(s.state), onFinished: (f) => finished.push(f), ...options
    });
    t.after(async () => { recorder.close(); await fake.stop(); });
    return { fake, recorder, finished, states, logs, port };
}

test('configFromEnv: off with nothing set, else an address and password', () => {
    assert.strictEqual(configFromEnv({}).enabled, false);
    assert.deepStrictEqual(configFromEnv({ OBS_WEBSOCKET_PASSWORD: 'pw' }),
        { enabled: true, url: 'ws://127.0.0.1:4455', password: 'pw', error: null });
    assert.strictEqual(configFromEnv({ OBS_WEBSOCKET_URL: '10.0.0.5:4455' }).url, 'ws://10.0.0.5:4455');
    assert.strictEqual(configFromEnv({ OBS_WEBSOCKET_URL: 'wss://obs.local:4455/' }).url, 'wss://obs.local:4455');
    const bad = configFromEnv({ OBS_WEBSOCKET_URL: 'http://127.0.0.1:4455' });
    assert.strictEqual(bad.enabled, true);
    assert.match(bad.error, /ws:\/\//);
});

test('with nothing configured the recorder is off and never connects', async () => {
    const recorder = createRecorder({ url: 'ws://127.0.0.1:1', enabled: false, createClient: () => assert.fail('no client should be made') });
    assert.strictEqual(recorder.status().state, 'off');
    await recorder.connect();
    assert.strictEqual((await recorder.startRecording()).ok, false);
    assert.strictEqual(recorder.status().state, 'off');
});

test('an address that is not a WebSocket one is an error state, not a crash', async () => {
    const recorder = createRecorder({ ...(({ error, ...rest }) => ({ ...rest, configError: error }))(configFromEnv({ OBS_WEBSOCKET_URL: 'http://x' })), log: () => {} });
    assert.strictEqual(recorder.status().state, 'error');
    assert.match(recorder.status().error, /ws:\/\//);
    assert.strictEqual((await recorder.startRecording()).ok, false);
});

test('connects and follows a recording started and stopped from here', async (t) => {
    const { fake, recorder, finished } = await setup(t);
    await recorder.connect();
    assert.strictEqual(recorder.status().state, 'idle');

    const started = await recorder.startRecording();
    assert.deepStrictEqual([started.ok, started.result], [true, 'sent']);
    await until(() => recorder.status().state === 'recording', 'recording state');
    assert.strictEqual(recorder.recording(), true);

    fake.recordTo = '/videos/2026-11-22 19-30-00.mp4';
    const stopped = await recorder.stopRecording();
    assert.deepStrictEqual([stopped.ok, stopped.result], [true, 'sent']);
    await until(() => recorder.status().state === 'idle', 'idle state');
    await until(() => finished.length === 1, 'the finished recording');
    assert.strictEqual(finished[0].path, '/videos/2026-11-22 19-30-00.mp4');
    assert.ok(finished[0].startedAt && finished[0].stoppedAt >= finished[0].startedAt);
    assert.deepStrictEqual(fake.requests.filter((r) => r !== 'GetRecordStatus'), ['StartRecord', 'StopRecord']);
});

test('starting while recording, and stopping while idle, are harmless', async (t) => {
    const { fake, recorder, finished } = await setup(t);
    await recorder.connect();
    const idleStop = await recorder.stopRecording();
    assert.deepStrictEqual([idleStop.ok, idleStop.result], [true, 'noop']);

    await recorder.startRecording();
    await until(() => recorder.status().state === 'recording', 'recording');
    const again = await recorder.startRecording();
    assert.deepStrictEqual([again.ok, again.result], [true, 'noop']);
    assert.strictEqual(recorder.status().state, 'recording');
    assert.strictEqual(recorder.status().notice, null);
    assert.strictEqual(finished.length, 0);
    assert.strictEqual(fake.active, true);
});

test('follows OBS when someone starts, pauses and stops recording by hand', async (t) => {
    const { fake, recorder, finished } = await setup(t);
    await recorder.connect();

    fake.setRecording(true);
    await until(() => recorder.status().state === 'recording', 'hand start');
    fake.setPaused(true);
    await until(() => recorder.status().state === 'paused', 'paused');
    fake.setPaused(false);
    await until(() => recorder.status().state === 'recording', 'resumed');
    fake.setRecording(false, '/videos/by-hand.mp4');
    await until(() => recorder.status().state === 'idle', 'hand stop');
    await until(() => finished.length === 1, 'finished by hand');
    assert.strictEqual(finished[0].path, '/videos/by-hand.mp4');
});

test('already recording when it connects: the state is recording from the start', async (t) => {
    const { fake, recorder } = await setup(t);
    fake.active = true;
    fake.startedAt = Date.now() - 5000;
    await recorder.connect();
    assert.strictEqual(recorder.status().state, 'recording');
});

test('a wrong password is an error state; a missing one says OBS needs it', async (t) => {
    const wrong = await setup(t, { password: 'right', clientPassword: 'wrong' });
    await assert.rejects(wrong.recorder.connect());
    assert.deepStrictEqual([wrong.recorder.status().state, wrong.recorder.status().error], ['error', 'OBS rejected the password']);
    const result = await wrong.recorder.startRecording();
    assert.deepStrictEqual([result.ok, result.result], [false, 'unreachable']);
    assert.strictEqual(wrong.fake.active, false);

    const none = await setup(t, { password: 'right', clientPassword: '' });
    await assert.rejects(none.recorder.connect());
    assert.strictEqual(none.recorder.status().error, 'OBS needs a password');

    const right = await setup(t, { password: 'right' });
    await right.recorder.connect();
    assert.strictEqual(right.recorder.status().state, 'idle');
});

test('OBS not running is an error, and it connects by itself once OBS is up', async (t) => {
    const { fake, recorder, logs } = await setup(t, { listen: false });
    await assert.rejects(recorder.connect());
    assert.deepStrictEqual([recorder.status().state, recorder.status().error], ['error', 'OBS is not reachable']);
    const result = await recorder.startRecording();
    assert.deepStrictEqual([result.ok, result.result], [false, 'unreachable']);

    await new Promise((resolve) => setTimeout(resolve, 200));
    // Repeated failures are one log line, not a line per retry.
    assert.strictEqual(logs.filter((l) => /not reachable/.test(l)).length, 1);

    await fake.start();
    await until(() => recorder.status().state === 'idle', 'automatic reconnect');
});

test('reconnects after OBS restarts, and a command then works', async (t) => {
    const { fake, recorder } = await setup(t);
    await recorder.connect();
    await recorder.startRecording();
    await until(() => recorder.status().state === 'recording', 'recording');

    await fake.stop();
    await until(() => recorder.status().state === 'error', 'error after OBS quit');
    assert.strictEqual(recorder.recording(), false);

    fake.active = false;
    await fake.start();
    await until(() => recorder.status().state === 'idle', 'reconnected, OBS idle again');
    const again = await recorder.startRecording();
    assert.strictEqual(again.ok, true);
});

test('a request OBS never answers times out instead of hanging', async (t) => {
    const { fake, recorder } = await setup(t);
    await recorder.connect();
    fake.hang = true;
    const result = await recorder.startRecording();
    assert.deepStrictEqual([result.ok, result.result], [false, 'failed']);
    assert.match(result.error, /did not answer/);
    assert.match(recorder.status().notice.text, /did not answer/);
});

test('a connection that never completes times out as unreachable', async (t) => {
    const hung = { identified: false, on() {}, connect: () => new Promise(() => {}), call: () => new Promise(() => {}), disconnect: async () => {} };
    const recorder = createRecorder({ url: 'ws://x', createClient: () => hung, connectTimeoutMs: 50, retryMs: 10000, log: () => {} });
    t.after(() => recorder.close());
    await assert.rejects(recorder.connect(), /timed out/);
    assert.strictEqual(recorder.status().error, 'OBS is not reachable');
});

test('a listener or finished-handler that throws does not break the recorder', async (t) => {
    const { fake, recorder } = await setup(t, {
        onStatus: () => { throw new Error('listener broke'); },
        onFinished: () => { throw new Error('handler broke'); }
    });
    await recorder.connect();
    fake.setRecording(true);
    await until(() => recorder.status().state === 'recording', 'recording');
    fake.setRecording(false, '/videos/x.mp4');
    await until(() => recorder.status().state === 'idle', 'idle');
});

// The start time of a recording: OBS says STARTED after the first frame, so the
// recorder asks how long it has been recording and counts back from there.
test('the start counts back from how long OBS says it had been recording', async (t) => {
    const { fake, recorder, finished, logs } = await setup(t);
    await recorder.connect();
    fake.leadMs = 3000;
    const before = Date.now();
    await recorder.startRecording();
    await until(() => recorder.status().state === 'recording', 'recording');
    fake.recordTo = '/videos/2026-11-22 19-30-00.mp4';
    await recorder.stopRecording();
    await until(() => finished.length === 1, 'the finished recording');
    const { startedAt, startSource, stoppedAt, stoppingAt } = finished[0];
    assert.strictEqual(startSource, 'obs');
    // About three seconds before STARTED was heard, never later than it.
    assert.ok(startedAt <= before + 50 - 3000 + 400, `start ${startedAt - before}`);
    assert.ok(startedAt >= before - 3000 - 50, `start ${startedAt - before}`);
    assert.ok(stoppingAt && stoppingAt <= stoppedAt);
    assert.ok(logs.some((l) => /had been recording 3\d{3} ms when it said so/.test(l)), logs.join('\n'));
});

test('with no recorded length to count back from the start is when STARTED arrived', async (t) => {
    const { fake, recorder, finished, logs } = await setup(t);
    await recorder.connect();
    fake.leadMs = 3000;
    fake.statusError = true;
    const before = Date.now();
    await recorder.startRecording();
    await until(() => recorder.status().state === 'recording', 'recording');
    await until(() => logs.some((l) => /could not ask how long/.test(l)), 'the fallback line');
    fake.recordTo = '/videos/2026-11-22 19-30-00.mp4';
    await recorder.stopRecording();
    await until(() => finished.length === 1, 'the finished recording');
    assert.strictEqual(finished[0].startSource, 'event');
    assert.ok(finished[0].startedAt >= before && finished[0].startedAt <= before + 1000);
});

test('an answer that is not believable leaves the start where STARTED put it', async (t) => {
    const { fake, recorder, finished, logs } = await setup(t);
    await recorder.connect();
    fake.leadMs = 10 * 60 * 1000;
    await recorder.startRecording();
    await until(() => logs.some((l) => /not believable/.test(l)), 'the refusal line');
    fake.recordTo = '/videos/a.mp4';
    await recorder.stopRecording();
    await until(() => finished.length === 1, 'the finished recording');
    assert.strictEqual(finished[0].startSource, 'event');
});

test('a recording that is over before OBS answers is still reported, with the time STARTED arrived', async (t) => {
    const { fake, recorder, finished, logs } = await setup(t);
    await recorder.connect();
    fake.leadMs = 2000;
    fake.setRecording(true);
    fake.setRecording(false, '/videos/quick.mp4');
    await until(() => finished.length === 1, 'the finished recording');
    // OBS no longer reports the output active, so there is no length to count back from.
    assert.strictEqual(finished[0].startSource, 'event');
    assert.ok(logs.some((l) => /could not read how long/.test(l)), logs.join('\n'));
});

test('a recording already running when the recorder connects counts back from its length', async (t) => {
    const { fake, recorder, finished } = await setup(t);
    fake.setRecording(true);
    fake.startedAt = Date.now() - 60000;
    await recorder.connect();
    const before = Date.now();
    fake.recordTo = '/videos/running.mp4';
    fake.setRecording(false);
    await until(() => finished.length === 1, 'the finished recording');
    assert.strictEqual(finished[0].startSource, 'connect');
    assert.ok(Math.abs(finished[0].startedAt - (before - 60000)) < 1500);
});
