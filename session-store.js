// express-session store kept in a local JSON file, so logins survive a server
// restart without depending on anything outside the venue LAN. Sessions live
// in memory and the logged-in ones are rewritten (atomically) whenever one is
// saved or destroyed; expired sessions are dropped on load and on a timer.
// Sessions without a user (login still in progress) stay in memory only and
// expire after LOGIN_TTL_MS, so cookieless clients cannot grow the file.
const fs = require('fs');
const session = require('express-session');

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_TTL_MS = 15 * 60 * 1000;
const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

function isLoggedIn(sess) {
    return Boolean(sess && sess.user);
}

function expiryOf(sess, now) {
    const expires = sess && sess.cookie && sess.cookie.expires;
    const time = expires ? new Date(expires).getTime() : NaN;
    const cookieExpiry = Number.isFinite(time) ? time : now + DEFAULT_TTL_MS;
    return isLoggedIn(sess) ? cookieExpiry : Math.min(cookieExpiry, now + LOGIN_TTL_MS);
}

class FileSessionStore extends session.Store {
    constructor({ file, pruneIntervalMs = PRUNE_INTERVAL_MS, now = Date.now } = {}) {
        super();
        this.file = file;
        this.now = now;
        this.sessions = new Map(); // sid -> { sess, expires }
        this.load();
        if (pruneIntervalMs > 0) {
            this.pruneTimer = setInterval(() => this.prune(), pruneIntervalMs);
            this.pruneTimer.unref();
        }
    }

    load() {
        let data;
        try {
            data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.log(`Sessions: ignoring unreadable ${this.file}: ${error.message}`);
            }
            return;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        const now = this.now();
        for (const [sid, entry] of Object.entries(data)) {
            if (entry && isLoggedIn(entry.sess) && typeof entry.expires === 'number' && entry.expires > now) {
                this.sessions.set(sid, entry);
            }
        }
    }

    save() {
        const persisted = {};
        for (const [sid, entry] of this.sessions) {
            if (isLoggedIn(entry.sess)) persisted[sid] = entry;
        }
        try {
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(persisted), { mode: 0o600 });
            fs.renameSync(tmp, this.file);
        } catch (error) {
            console.log(`Sessions: could not save ${this.file}: ${error.message}`);
        }
    }

    prune() {
        const now = this.now();
        let removedPersisted = false;
        for (const [sid, entry] of this.sessions) {
            if (entry.expires <= now) {
                this.sessions.delete(sid);
                if (isLoggedIn(entry.sess)) removedPersisted = true;
            }
        }
        if (removedPersisted) this.save();
    }

    get(sid, callback) {
        const entry = this.sessions.get(sid);
        if (!entry) return callback(null, null);
        if (entry.expires <= this.now()) {
            this.sessions.delete(sid);
            if (isLoggedIn(entry.sess)) this.save();
            return callback(null, null);
        }
        callback(null, JSON.parse(JSON.stringify(entry.sess)));
    }

    set(sid, sess, callback) {
        const previous = this.sessions.get(sid);
        this.sessions.set(sid, { sess: JSON.parse(JSON.stringify(sess)), expires: expiryOf(sess, this.now()) });
        if (isLoggedIn(sess) || (previous && isLoggedIn(previous.sess))) this.save();
        if (callback) callback(null);
    }

    // Called on every request for an unmodified session. The browser cookie
    // keeps its original expiry (rolling is off), so this only refreshes the
    // in-memory expiry and skips the disk write.
    touch(sid, sess, callback) {
        const entry = this.sessions.get(sid);
        if (entry) entry.expires = expiryOf(sess, this.now());
        if (callback) callback(null);
    }

    destroy(sid, callback) {
        const entry = this.sessions.get(sid);
        this.sessions.delete(sid);
        if (entry && isLoggedIn(entry.sess)) this.save();
        if (callback) callback(null);
    }

    close() {
        clearInterval(this.pruneTimer);
    }
}

module.exports = { FileSessionStore };
