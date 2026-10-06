// Restores the chat log after a server restart. The log only lives in server
// memory, but every connected browser still holds a copy of the one it last
// received (public/chat-copy.js). Offers are untrusted client input, so they
// are validated and rebuilt field by field before anything is compared or
// stored.
//
// Agreement: log A agrees with log B when every message of A is also in B,
// meaning the same id and identical user, userId, text and timestamp. A message
// with a known id but different content is a disagreement, not a duplicate.
// A log is vouched for by every distinct user whose offer agrees with it (its
// own offer included). The fullest log vouched for by at least two distinct
// users is restored, so a short history agreeing with a long one backs it, and
// a larger agreed history arriving later is merged over a smaller restored one.
// A user that offers again replaces their earlier offer; several tabs of one
// user are still one voice.
//
// The window for offers opens at server start and closes after windowMs, so it
// cannot stay open forever. Messages sent in the meantime do not close it:
// the caller merges a restored log into whatever the server already holds.

const MAX_ID = 64;
const MAX_NAME = 200;
const MAX_TEXT = 5000;
const MAX_TIMESTAMP = 40;
// Generous ceiling on one offer's length, there only to stop an absurd payload.
// The byte size is bounded by the socket's maxHttpBufferSize (server.js).
const MAX_OFFER_MESSAGES = 200000;
const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

function cleanString(value, max) {
    return typeof value === 'string' && value.length <= max ? value : null;
}

// Returns a canonical copy of the offered log, or null if it is malformed.
function sanitizeChatLog(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OFFER_MESSAGES) return null;
    const log = [];
    for (const m of raw) {
        if (!m || typeof m !== 'object') return null;
        const id = cleanString(m.id, MAX_ID);
        const user = cleanString(m.user, MAX_NAME);
        const userId = cleanString(m.userId, MAX_NAME);
        const text = cleanString(m.text, MAX_TEXT);
        const timestamp = cleanString(m.timestamp, MAX_TIMESTAMP);
        if (id === null || user === null || userId === null || text === null || timestamp === null) return null;
        if (Number.isNaN(Date.parse(timestamp))) return null;
        log.push({ id, user, userId, text, timestamp });
    }
    return log;
}

// Bounds a live chat message to the limits sanitizeChatLog enforces, so every
// stored message can later be restored. Returns null if the text is not a string.
function boundChatMessage({ user, userId, text }) {
    if (typeof text !== 'string') return null;
    return {
        user: String(user ?? '').slice(0, MAX_NAME),
        userId: String(userId ?? '').slice(0, MAX_NAME),
        text: text.slice(0, MAX_TEXT)
    };
}

// Two messages are the same message only if every field is identical.
function messageKey(m) {
    return JSON.stringify([m.id, m.user, m.userId, m.text, m.timestamp]);
}

// True when every message of `inner` is in `outer` (see "Agreement" above).
function agrees(innerKeys, outerKeys) {
    if (innerKeys.size > outerKeys.size) return false;
    for (const key of innerKeys) if (!outerKeys.has(key)) return false;
    return true;
}

// Union of two logs, ordered by timestamp, one message per id (`current` wins).
// The sort is stable, so equal timestamps keep their order.
function mergeChatLogs(current, restored) {
    const seen = new Set(current.map((m) => m.id));
    const merged = [...current];
    for (const m of restored) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        merged.push(m);
    }
    return merged.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

// onClose runs once, when the window closes.
function createChatRestore({ windowMs = DEFAULT_WINDOW_MS, onClose = () => {} } = {}) {
    const offers = new Map(); // userId -> { log, keys }
    let closed = false;
    let timer = null;

    function close() {
        if (closed) return;
        closed = true;
        offers.clear();
        clearTimeout(timer);
        onClose();
    }

    timer = setTimeout(close, windowMs);
    timer.unref();

    // The fullest offered log that at least two distinct users vouch for.
    function fullestAgreed() {
        let best = null;
        for (const candidate of offers.values()) {
            if (best && candidate.log.length <= best.length) continue;
            let vouchers = 0;
            for (const o of offers.values()) if (agrees(o.keys, candidate.keys)) vouchers++;
            if (vouchers >= 2) best = candidate.log;
        }
        return best;
    }

    return {
        close,
        get closed() { return closed; },
        // Returns an agreed log holding messages that `currentLog` (what the
        // server has now) lacks, for the caller to merge in, else null.
        offer(userId, raw, currentLog) {
            if (closed) return null;
            const log = sanitizeChatLog(raw);
            if (!log || typeof userId !== 'string') return null;
            offers.set(userId, { log, keys: new Set(log.map(messageKey)) });
            const best = fullestAgreed();
            if (!best) return null;
            const have = new Set(currentLog.map((m) => m.id));
            return best.some((m) => !have.has(m.id)) ? best : null;
        }
    };
}

module.exports = { createChatRestore, sanitizeChatLog, boundChatMessage, mergeChatLogs, messageKey, agrees, MAX_OFFER_MESSAGES, DEFAULT_WINDOW_MS };
