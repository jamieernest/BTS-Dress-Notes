// Starts and stops recording in OBS Studio (28+) over its built-in WebSocket
// server, and follows OBS's own record state so the app stays right when
// someone presses Record in OBS by hand.
//
// OBS cannot receive OSC, so server.js turns QLab's `/bts/record/start` and
// `/bts/record/stop` (record-command.js) into calls here. Nothing here may
// throw into or block the rest of the server: OBS being off, a wrong password
// or a hung request only ever becomes an error state plus a log line, and a
// lost connection is retried in the background with a growing pause.
//
// Settings come from the environment (configFromEnv); with neither an address
// nor a password set the feature is off.

// The JSON subprotocol, which every obs-websocket 5 server speaks (the package's default in Node is MessagePack).
const { OBSWebSocket, EventSubscription } = require('obs-websocket-js/json');

const DEFAULT_URL = 'ws://127.0.0.1:4455';
const AUTH_FAILED = 4009; // WebSocketCloseCode.AuthenticationFailed
const OUTPUT_RUNNING = 500; // RequestStatus.OutputRunning
const OUTPUT_NOT_RUNNING = 501; // RequestStatus.OutputNotRunning

// The OBS settings in `env`: { enabled, url, password, error }.
function configFromEnv(env) {
    const rawUrl = String(env.OBS_WEBSOCKET_URL || '').trim();
    const password = String(env.OBS_WEBSOCKET_PASSWORD || '');
    if (!rawUrl && !password) return { enabled: false, url: DEFAULT_URL, password: '', error: null };
    let url = rawUrl || DEFAULT_URL;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `ws://${url}`;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') throw new Error('not a WebSocket address');
        url = parsed.href.replace(/\/$/, '');
    } catch (error) {
        return { enabled: true, url: rawUrl, password, error: 'OBS_WEBSOCKET_URL is not a ws:// address' };
    }
    return { enabled: true, url, password, error: null };
}

function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'ETIMEDOUT' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A recording OBS says has run longer than this when STARTED arrives is not
// believed (the event cannot be that late), so the event's own time stands.
const MAX_LEAD_MS = 30000;

// `onStatus(status)` on every change; `onFinished({ path, startedAt, stoppedAt,
// stoppingAt, startSource, paused })` when OBS finishes a recording (`startedAt`
// is when the file's first frame was recorded, in ms; `startSource` says how it
// was found: 'obs' when OBS's own recorded length was subtracted, 'event' when
// only the time STARTED arrived is known, 'connect' for a recording already
// running when this connected); `onConnected()` each time OBS is (re)connected.
function createRecorder({
    url, password = '', enabled = true, configError = null, createClient = () => new OBSWebSocket(),
    retryMs = 5000, maxRetryMs = Math.max(30000, retryMs), connectTimeoutMs = 8000, requestTimeoutMs = 8000,
    startLookupMs = Math.min(requestTimeoutMs, 3000),
    now = Date.now, log = console.log, onStatus = () => {}, onFinished = () => {}, onConnected = () => {}
}) {
    const usable = enabled && !configError;
    const status = { enabled, state: enabled ? 'connecting' : 'off', error: null, url, notice: null };
    let client = null;
    let connecting = null;
    let retryTimer = null;
    let attempts = 0;
    let closed = false;
    // The recording in progress: { startedAt, source, stoppingAt, paused, refining }.
    let recording = null;
    let lastLogged = null;
    let lastSent = '';

    function publish() {
        const text = JSON.stringify(status);
        if (text === lastSent) return;
        lastSent = text;
        try { onStatus({ ...status }); } catch (error) { log('OBS: status listener failed:', error.message); }
    }

    function setState(state, error = null) {
        status.state = state;
        status.error = error;
        publish();
    }

    // Logs a line unless it repeats the last one, so a retry loop is one line.
    function logOnce(text) {
        if (text === lastLogged) return;
        lastLogged = text;
        log(text);
    }

    function describe(error) {
        if (error && error.code === AUTH_FAILED) return password ? 'OBS rejected the password' : 'OBS needs a password';
        return 'OBS is not reachable';
    }

    function setNotice(text) {
        status.notice = text ? { text, at: new Date(now()).toISOString() } : null;
        publish();
    }

    function fail(error) {
        const text = describe(error);
        const detail = error && (error.code || error.message) ? ` (${[error.code, error.message].filter(Boolean).join(' ')})` : '';
        logOnce(`OBS: ${text} at ${url}${detail}`);
        setState('error', text);
    }

    function scheduleRetry() {
        if (closed || retryTimer) return;
        const delay = Math.min(retryMs * 2 ** Math.min(attempts, 6), maxRetryMs);
        attempts++;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            connect().catch(() => {});
        }, delay);
        if (retryTimer.unref) retryTimer.unref();
    }

    // OBS says STARTED some time after the file's first frame, so ask how long it
    // has been recording and count back from the answer. The time the answer was
    // taken is the middle of the round trip. Never rejects; on any failure the
    // time STARTED arrived stays as the start.
    function refineStart(c, rec, eventAt) {
        const asked = now();
        rec.refining = withTimeout(c.call('GetRecordStatus'), startLookupMs, 'OBS did not answer').then((record) => {
            const answered = now();
            const length = Number(record && record.outputDuration);
            if (!record || record.outputActive !== true || !Number.isFinite(length) || length < 0) {
                log('OBS: could not read how long the recording had run when OBS said it started; using that moment as its start');
                return;
            }
            if (length > MAX_LEAD_MS) {
                log(`OBS: reported ${length} ms recorded when it said it started, which is not believable; using that moment as its start`);
                return;
            }
            const reportedAt = (asked + answered) / 2;
            // Never after STARTED itself, which the round trip's own timing could otherwise suggest.
            rec.startedAt = Math.min(reportedAt - length, eventAt);
            rec.source = 'obs';
            log(`OBS: recording started; OBS had been recording ${length} ms when it said so (${answered - asked} ms to ask), so the recording began ${Math.round(eventAt - rec.startedAt)} ms before STARTED arrived`);
        }).catch((error) => {
            log(`OBS: could not ask how long the recording had run (${error && error.message}); using the moment OBS said it started`);
        });
    }

    function handleRecordState({ outputState, outputActive, outputPath } = {}, c = client) {
        const stateName = String(outputState || '').replace('OBS_WEBSOCKET_OUTPUT_', '');
        if (stateName === 'STARTING') {
            setNotice(null);
            setState('starting');
        } else if (stateName === 'STARTED') {
            const eventAt = now();
            const rec = { startedAt: eventAt, source: 'event', stoppingAt: null, paused: false, refining: null };
            recording = rec;
            status.notice = null;
            setState('recording');
            log('OBS: recording started');
            if (c) refineStart(c, rec, eventAt);
        } else if (stateName === 'PAUSED') {
            if (recording) recording.paused = true;
            setState('paused');
        } else if (stateName === 'RESUMED') {
            setState('recording');
        } else if (stateName === 'STOPPING') {
            if (recording && !recording.stoppingAt) recording.stoppingAt = now();
            setState('stopping');
        } else if (stateName === 'STOPPED') {
            const rec = recording;
            const stoppedAt = now();
            recording = null;
            setState('idle');
            log(`OBS: recording stopped${outputPath ? ` (${outputPath})` : ''}`);
            if (outputPath) {
                // A recording that is over before OBS has answered still waits for its start.
                Promise.resolve(rec && rec.refining).then(() => onFinished({
                    path: String(outputPath), startedAt: rec ? rec.startedAt : null, stoppedAt,
                    stoppingAt: rec ? rec.stoppingAt : null, startSource: rec ? rec.source : null, paused: rec ? rec.paused : false
                })).catch((error) => log('OBS: could not add the recording:', error.message));
            }
        } else if (outputActive === true || outputActive === false) {
            setState(outputActive ? 'recording' : 'idle');
        }
    }

    function dropClient(c) {
        if (client !== c) return;
        client = null;
        recording = null;
    }

    function connect() {
        if (closed || !usable) return Promise.resolve();
        if (client && client.identified) return Promise.resolve();
        if (connecting) return connecting;
        
        const c = createClient();
        connecting = (async () => {
            try {
                c.on('RecordStateChanged', (data) => handleRecordState(data, c));
                c.on('ConnectionClosed', (error) => {
                    if (client !== c) return;
                    dropClient(c);
                    fail(error);
                    scheduleRetry();
                });
                await withTimeout(
                    c.connect(url, password || undefined, { rpcVersion: 1, eventSubscriptions: EventSubscription.Outputs }),
                    connectTimeoutMs, 'timed out connecting to OBS'
                );
                const record = await withTimeout(c.call('GetRecordStatus'), requestTimeoutMs, 'OBS did not answer');
                if (closed) throw new Error('closed');
                client = c;
                attempts = 0;
                lastLogged = null;
                log(`OBS: connected at ${url}`);
                if (record.outputActive) {
                    recording = { startedAt: now() - (Number(record.outputDuration) || 0), source: 'connect', stoppingAt: null, paused: !!record.outputPaused, refining: null };
                    setState(record.outputPaused ? 'paused' : 'recording');
                } else {
                    recording = null;
                    setState('idle');
                }
                try { onConnected(); } catch (error) { log('OBS: connected handler failed:', error.message); }
            } catch (error) {
                c.disconnect().catch(() => {});
                if (!closed) {
                    fail(error);
                    scheduleRetry();
                }
                throw error;
            }
        })().finally(() => { connecting = null; });
        // A failure is reported through the state; a caller that does not wait must not leave it unhandled.
        connecting.catch(() => {});
        return connecting;
    }

    // Runs one OBS request after making sure there is a connection.
    // Resolves to { ok, result, error }: result is 'sent' or 'noop' (OBS was already
    // in the state asked for). It never rejects.
    async function request(type, harmless) {
        try {
            await connect();
        } catch (error) {
            return { ok: false, result: 'unreachable', error: status.error || describe(error) };
        }
        if (!client) return { ok: false, result: 'unreachable', error: status.error || 'OBS is not reachable' };
        try {
            await withTimeout(client.call(type), requestTimeoutMs, 'OBS did not answer');
            return { ok: true, result: 'sent' };
        } catch (error) {
            if (error && error.code === harmless) return { ok: true, result: 'noop' };
            log(`OBS: ${type} failed: ${error && error.message}`);
            const text = error && error.code === 'ETIMEDOUT' ? 'OBS did not answer' : `OBS refused to ${type === 'StartRecord' ? 'start' : 'stop'} recording${error && error.message ? `: ${error.message}` : ''}`;
            setNotice(text);
            return { ok: false, result: 'failed', error: text };
        }
    }

    function startRecording() {
        if (!usable) return Promise.resolve({ ok: false, result: 'off', error: status.error || 'OBS is not set up' });
        return request('StartRecord', OUTPUT_RUNNING);
    }

    function stopRecording() {
        if (!usable) return Promise.resolve({ ok: false, result: 'off', error: status.error || 'OBS is not set up' });
        return request('StopRecord', OUTPUT_NOT_RUNNING);
    }

    function close() {
        closed = true;
        clearTimeout(retryTimer);
        retryTimer = null;
        const c = client;
        client = null;
        if (c) c.disconnect().catch(() => {});
    }

    if (enabled && configError) {
        status.state = 'error';
        status.error = configError;
        log(`OBS: ${configError}`);
    }

    return {
        connect, startRecording, stopRecording, close, setNotice,
        status: () => ({ ...status }),
        recording: () => ['recording', 'paused', 'starting', 'stopping'].includes(status.state)
    };
}

module.exports = { configFromEnv, createRecorder, DEFAULT_URL };
