// OSC cues that start and stop the OBS recording: `/bts/record/start` and
// `/bts/record/stop` from QLab, on the same UDP port as the scene labels.
//
// They live under `/bts/` like the scene label address, so server.js asks
// isRecordAddress() before treating any `/bts/...` message as a scene.
// Everything under `/bts/record` belongs to this feature; an address in there
// that is not one of the two commands is ignored, never taken for a scene.
//
// With a secret configured (OBS_OSC_SECRET) the message must carry it as an
// OSC argument. The secret is only compared, never logged.
//
// `/bts/record/start` may also carry a camera preset number (1-based, a number
// or digits), e.g. `/bts/record/start 9` or `/bts/record/start my-secret 9`.
// The secret check comes first and uses up the first argument equal to the
// secret, so a numeric secret is never taken for a preset; the preset is the
// first remaining numeric argument. Other arguments are ignored.

const crypto = require('node:crypto');
const camera = require('./lumens-camera');

const PREFIX = '/bts/record';
const COMMANDS = { [`${PREFIX}/start`]: 'start', [`${PREFIX}/stop`]: 'stop' };

function isRecordAddress(address) {
    return typeof address === 'string' && (address === PREFIX || address.startsWith(`${PREFIX}/`));
}

// Hashing both sides first gives timingSafeEqual equal-length inputs.
function sameText(a, b) {
    const hash = (text) => crypto.createHash('sha256').update(text).digest();
    return crypto.timingSafeEqual(hash(a), hash(b));
}

// The camera preset on a start cue: { preset } (a whole number 1-255),
// { invalid: true } for a number that cannot be a preset, or {} for none.
function presetFromArgs(args, secret) {
    const rest = (Array.isArray(args) ? args : []).slice();
    if (secret) {
        const at = rest.findIndex((arg) => (typeof arg === 'string' || typeof arg === 'number') && sameText(String(arg), secret));
        if (at >= 0) rest.splice(at, 1);
    }
    for (const arg of rest) {
        const text = typeof arg === 'number' ? String(arg) : typeof arg === 'string' ? arg.trim() : '';
        if (!/^-?\d+(\.\d+)?$/.test(text)) continue;
        const preset = camera.parsePreset(arg);
        return preset === null ? { invalid: true } : { preset };
    }
    return {};
}

// Whether any of the message's arguments is the secret. QLab may send a
// number for a numeric secret, so arguments are compared as text.
function carriesSecret(args, secret) {
    if (!secret) return true;
    return (Array.isArray(args) ? args : []).some((arg) => {
        const type = typeof arg;
        return (type === 'string' || type === 'number') && sameText(String(arg), secret);
    });
}

// What to do with a message under `/bts/record`: { action: 'start' | 'stop' },
// or { ignored: 'unknown' | 'secret' } when it must not do anything. A start
// also carries `preset` (a camera preset number) or `invalidPreset: true`.
function parseRecordCommand(address, args, secret) {
    const action = Object.hasOwn(COMMANDS, address) ? COMMANDS[address] : null;
    if (!action) return { ignored: 'unknown' };
    if (!carriesSecret(args, secret)) return { ignored: 'secret' };
    if (action === 'start') {
        const { preset, invalid } = presetFromArgs(args, secret);
        if (preset) return { action, preset };
        if (invalid) return { action, invalidPreset: true };
    }
    return { action };
}

module.exports = { PREFIX, isRecordAddress, carriesSecret, presetFromArgs, parseRecordCommand };
