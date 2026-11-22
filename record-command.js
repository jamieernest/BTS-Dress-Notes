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

const crypto = require('node:crypto');

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
// or { ignored: 'unknown' | 'secret' } when it must not do anything.
function parseRecordCommand(address, args, secret) {
    const action = Object.hasOwn(COMMANDS, address) ? COMMANDS[address] : null;
    if (!action) return { ignored: 'unknown' };
    if (!carriesSecret(args, secret)) return { ignored: 'secret' };
    return { action };
}

module.exports = { PREFIX, isRecordAddress, carriesSecret, parseRecordCommand };
