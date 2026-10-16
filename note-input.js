// Cleans what browsers send over the socket before it is stored or broadcast.
// Every client is trusted to be logged in, not to be well formed: a missing or
// odd field from an old tab, a bug or a hand-made message must not throw (one
// exception in a handler used to take the server down for everyone) or put
// junk into the notes every other browser renders.

const MAX_NOTE_LENGTH = 10000;
const MAX_COMMENT_LENGTH = 5000;
const MAX_TAGS = 50;
const MAX_TAG_NAME_LENGTH = 60;
const MAX_ID_LENGTH = 100;
const MAX_CUE_LENGTH = 200;
const MODES = ['midi', 'network', 'realtime'];

// Text with something in it, cut to `max` characters; null if there is none.
function cleanText(value, max) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    return value.length > max ? value.slice(0, max) : value;
}

// A short identifier string (note, comment, tag or client id), or null.
function cleanId(value) {
    if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
    return typeof value === 'string' && value && value.length <= MAX_ID_LENGTH ? value : null;
}

// A list of distinct tag ids; anything else becomes an empty list.
function cleanTags(value) {
    if (!Array.isArray(value)) return [];
    const ids = [];
    for (const v of value) {
        const id = cleanId(v);
        if (id && !ids.includes(id)) ids.push(id);
        if (ids.length >= MAX_TAGS) break;
    }
    return ids;
}

function wholeNumber(value, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : 0;
}

// A note's frame rate: a number of frames per second, or 'ms' for real time.
function cleanFrameRate(value) {
    if (value === 'ms') return 'ms';
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 120 ? n : null;
}

// A timecode as the browser froze it, keeping only the known fields; null if
// it is not one, so the caller falls back to the server's current timecode.
function cleanTimecode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!['hours', 'minutes', 'seconds'].every((k) => Number.isFinite(Number(value[k])))) return null;
    const tc = {
        hours: wholeNumber(value.hours, 99),
        minutes: wholeNumber(value.minutes, 59),
        seconds: wholeNumber(value.seconds, 59),
        frames: wholeNumber(value.frames, 119)
    };
    if (value.milliseconds !== undefined) tc.milliseconds = wholeNumber(value.milliseconds, 999);
    const frameRate = cleanFrameRate(value.frameRate);
    if (frameRate !== null) tc.frameRate = frameRate;
    if (MODES.includes(value.source)) tc.source = value.source;
    if (MODES.includes(value.displayMode)) tc.displayMode = value.displayMode;
    return tc;
}

// An LX cue label, or null.
function cleanCue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
    return typeof value === 'string' && value.trim() ? value.slice(0, MAX_CUE_LENGTH) : null;
}

// A tag from the tag editor: { id, name, color } with a #rgb/#rrggbb colour, or null.
function cleanTag(value) {
    if (!value || typeof value !== 'object') return null;
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, MAX_TAG_NAME_LENGTH) : '';
    if (!name) return null;
    const color = typeof value.color === 'string' && /^#(?:[0-9a-f]{3}){1,2}$/i.test(value.color) ? value.color : null;
    return { id: value.id === undefined ? null : cleanId(value.id), name, color };
}

module.exports = {
    MAX_NOTE_LENGTH, MAX_COMMENT_LENGTH,
    cleanText, cleanId, cleanTags, cleanFrameRate, cleanTimecode, cleanCue, cleanTag
};
