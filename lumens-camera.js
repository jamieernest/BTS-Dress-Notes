// Recalls a position preset on a Lumens VC-A61PN camera over its web UI's two
// JSON endpoints: log in (lums_login.cgi), then recall (lums_configuration.cgi).
//
// Configured from `.env` only (configFromEnv). With no CAMERA_HOST the feature
// is off. The username and password are only ever sent to the camera: never
// logged, never in the status that goes to pages, never in an error text.
//
// One login is reused until the camera rejects it or restarts, then the
// recall logs in again once and retries. Every camera request is bounded by
// one deadline per recall, and recalls run one at a time, so a dead camera can
// neither hang the caller nor be flooded. A failed recall never throws.

const crypto = require('node:crypto');

const MAX_PRESET = 255;
const DEFAULT_TIMEOUT_MS = 2000;

// A preset number as people count them (1-based), from a number or digits.
function parsePreset(value) {
    const text = typeof value === 'number' ? (Number.isInteger(value) ? String(value) : '') : typeof value === 'string' ? value.trim() : '';
    if (!/^\d{1,3}$/.test(text)) return null;
    const preset = Number(text);
    return preset >= 1 && preset <= MAX_PRESET ? preset : null;
}

// `host` or `host:port`, with an optional http:// and trailing slash tolerated.
function parseHost(value) {
    const text = String(value || '').trim().replace(/^http:\/\//i, '').replace(/\/+$/, '');
    if (!text) return null;
    return /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/.test(text) ? text : null;
}

function flag(value) {
    return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

// { enabled, host, username, password, preset, onScene, timeoutMs, error }.
function configFromEnv(env) {
    const raw = String(env.CAMERA_HOST || '').trim();
    const config = { enabled: false, host: '', username: '', password: '', preset: null, onScene: false, timeoutMs: DEFAULT_TIMEOUT_MS, error: null };
    if (!raw) return config;
    config.host = parseHost(raw);
    if (!config.host) return { ...config, host: '', error: 'CAMERA_HOST is not a host name or address' };
    config.enabled = true;
    config.username = String(env.CAMERA_USERNAME || '');
    config.password = String(env.CAMERA_PASSWORD || '');
    const timeout = Number(env.CAMERA_TIMEOUT_MS);
    if (Number.isFinite(timeout) && timeout >= 200) config.timeoutMs = Math.min(timeout, 10000);
    const presetText = String(env.CAMERA_PRESET || '').trim();
    if (presetText) {
        config.preset = parsePreset(presetText);
        if (config.preset === null) config.error = `CAMERA_PRESET must be a whole number from 1 to ${MAX_PRESET}`;
    }
    config.onScene = flag(env.CAMERA_RECALL_ON_SCENE) && config.preset !== null;
    return config;
}

// Safe to log: the camera's own words, shortened, without the password.
function clip(text, password) {
    let out = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (password) out = out.split(password).join('***');
    return out;
}

// Whether a 2xx body says no. The login body format is not documented, so
// only an explicit failure counts.
function bodyRejects(body) {
    let data;
    try { data = JSON.parse(body); } catch { return false; }
    if (!data || typeof data !== 'object') return false;
    if (data.success === false) return true;
    return ['result', 'status', 'ret', 'message'].some((key) =>
        typeof data[key] === 'string' && /^(fail|error|denied|invalid|unauthori|wrong)/i.test(data[key].trim()));
}

class CameraError extends Error {
    constructor(reason, { auth = false, detail = '' } = {}) {
        super(reason);
        this.reason = reason;
        this.auth = auth;
        this.detail = detail;
    }
}

function createCamera({ config, fetchImpl = globalThis.fetch, log = console.log, onStatus = () => {}, newUuid = () => crypto.randomUUID().toLowerCase() }) {
    const { enabled, host, username, password, timeoutMs } = config;
    const base = `http://${host}`;
    let uuid = null; // the login being reused
    let tail = Promise.resolve(); // recalls run one at a time
    let sceneRunning = false;
    let scenePending = false;
    let status = { configured: Boolean(enabled), state: enabled ? 'idle' : 'off', preset: null, at: null, error: config.error || null };

    function publish(next) {
        status = { ...status, ...next };
        try { onStatus({ ...status }); } catch { /* a page update must never matter here */ }
    }

    function headers(cookie) {
        return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Cookie: cookie };
    }

    async function post(path, body, cookie, signal) {
        let response;
        try {
            response = await fetchImpl(`${base}${path}`, { method: 'POST', headers: headers(cookie), body: JSON.stringify(body), signal });
        } catch (error) {
            if (signal.aborted) throw new CameraError('the camera did not answer in time');
            throw new CameraError('the camera is not reachable', { detail: error && error.cause && error.cause.code ? error.cause.code : '' });
        }
        let text = '';
        try { text = await response.text(); } catch { /* an empty body is fine */ }
        if (!response.ok) {
            throw new CameraError(`the camera answered HTTP ${response.status}`, { auth: response.status === 401 || response.status === 403, detail: clip(text, password) });
        }
        if (bodyRejects(text)) throw new CameraError('the camera refused the request', { auth: true, detail: clip(text, password) });
        return clip(text, password);
    }

    async function login(signal) {
        const id = newUuid();
        const said = await post('/cgi-bin/lums_login.cgi', { cmd: 'loginauth', username, password, uuid: id },
            'languAge=en; authority=0; vmsversion=VC-A61PN; vmsversionsub=; userName=; passWord=; uuId=', signal)
            .catch((error) => {
                if (error instanceof CameraError && error.auth) throw new CameraError('the camera rejected the login', { detail: error.detail });
                throw error;
            });
        log(`Camera: logged in${said ? `; camera said: ${said}` : ''}`);
        uuid = id;
    }

    function recallRequest(preset, signal) {
        const cookie = `languAge=en; userName=${username}; passWord=${password}; uuId=${uuid}; authority=0; vmsversion=VC-A61PN; vmsversionsub=`;
        return post('/cgi-bin/lums_configuration.cgi', { cmd: 'campresetrecall', uuid, memnum: String(preset) }, cookie, signal);
    }

    async function attempt(preset, signal) {
        if (!uuid) await login(signal);
        try {
            return await recallRequest(preset, signal);
        } catch (error) {
            if (signal.aborted || !(error instanceof CameraError)) throw error;
            // A rejected session or a camera that restarted: log in again, once.
            log(`Camera: ${error.reason}${error.detail ? ` (${error.detail})` : ''}; logging in again`);
            uuid = null;
            await login(signal);
            return recallRequest(preset, signal);
        }
    }

    async function run(preset) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const said = await attempt(preset, controller.signal);
            log(`Camera: recalled preset ${preset}${said ? `; camera said: ${said}` : ''}`);
            publish({ state: 'ok', preset, at: new Date().toISOString(), error: null });
            return { ok: true };
        } catch (error) {
            uuid = null;
            const reason = error instanceof CameraError ? error.reason : 'the recall failed';
            log(`Camera: could not recall preset ${preset}: ${reason}${error && error.detail ? ` (${error.detail})` : ''}`);
            publish({ state: 'failed', preset, at: new Date().toISOString(), error: reason });
            return { ok: false, error: reason };
        } finally {
            clearTimeout(timer);
        }
    }

    // Recall one preset; resolves with { ok } and never rejects.
    function recall(preset) {
        if (!enabled) return Promise.resolve({ ok: false, error: 'the camera is not set up' });
        const number = parsePreset(preset);
        if (number === null) return Promise.resolve({ ok: false, error: 'not a preset number' });
        const result = tail.then(() => run(number), () => run(number));
        tail = result.catch(() => {});
        return result;
    }

    // The scene label changed: recall the fixed preset without waiting for it.
    // Changes arriving during a recall collapse into one more recall after it.
    function sceneChanged() {
        if (!enabled || !config.onScene || config.preset === null) return;
        if (sceneRunning) {
            scenePending = true;
            return;
        }
        sceneRunning = true;
        recall(config.preset).finally(() => {
            sceneRunning = false;
            if (scenePending) {
                scenePending = false;
                sceneChanged();
            }
        });
    }

    return { recall, sceneChanged, status: () => ({ ...status }), enabled: () => Boolean(enabled) };
}

module.exports = { configFromEnv, createCamera, parsePreset, parseHost, MAX_PRESET };
