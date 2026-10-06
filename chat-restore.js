// Restores the chat log after a server restart. The log only lives in server
// memory, but every connected browser still holds the one it last received.
// When the log is empty, the first log offered identically by two distinct
// users wins. Offers are untrusted client input, so they are validated and
// rebuilt field by field before anything is compared or stored.

const MAX_MESSAGES = 100;
const MAX_ID = 64;
const MAX_NAME = 200;
const MAX_TEXT = 5000;
const MAX_TIMESTAMP = 40;

function cleanString(value, max) {
    return typeof value === 'string' && value.length <= max ? value : null;
}

// Returns a canonical copy of the offered log, or null if it is malformed.
function sanitizeChatLog(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
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

function createChatRestore() {
    const offers = new Map(); // userId -> { key, log }
    let closed = false;

    return {
        // Stop accepting offers (a message was sent, or a log was restored).
        close() {
            closed = true;
            offers.clear();
        },
        get closed() { return closed; },
        // Returns the log to restore once two distinct users agree, else null.
        offer(userId, raw, currentLog) {
            if (closed) return null;
            if (currentLog.length > 0) {
                this.close();
                return null;
            }
            const log = sanitizeChatLog(raw);
            if (!log || typeof userId !== 'string') return null;
            const key = JSON.stringify(log);
            offers.set(userId, { key, log });
            let agreeing = 0;
            for (const o of offers.values()) if (o.key === key) agreeing++;
            if (agreeing < 2) return null;
            this.close();
            return log;
        }
    };
}

module.exports = { createChatRestore, sanitizeChatLog, MAX_MESSAGES };
