// The browser's copy of the chat log, offered back to a restarted server (see
// chat-restore.js). It is kept in localStorage rather than page memory because
// people reload, or are bounced through /login, while the server is down, and
// a copy that dies with the page is gone before the server is back. Copies
// older than MAX_AGE_MS are dropped so a server restarted for a new show does
// not get an old show's chat back.
//
// While the server's restore window is open (it says so in chat-restore-status)
// the server's log may be a short post-restart one, so the copy only ever grows:
// what the server sends is merged into it. Once the window has closed the server
// is settled and its log replaces the copy.
//
// The chat has no length limit, but the browser's storage quota (about 5 MB per
// site) and the connection's message size are hard ceilings. A log too big for
// either is cut to its most recent messages.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.createChatCopy = factory().createChatCopy;
}(typeof self !== 'undefined' ? self : this, function () {
    const KEY = 'chat-log-copy';
    const MAX_AGE_MS = 2 * 60 * 60 * 1000; // the app should not be down for longer than this during a dress
    // Longest offer, in JSON characters. The server accepts 16 MB per message,
    // and a character is at most 3 bytes of it, which 5 million stays under.
    const MAX_OFFER_CHARS = 5000000;

    // Union by message id, ordered by timestamp; `first` wins on a clash.
    function merge(first, second) {
        const seen = new Set(first.map((m) => m.id));
        const merged = [...first];
        for (const m of second) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            merged.push(m);
        }
        return merged.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    }

    // The most recent messages of `log` whose JSON stays within `maxChars`.
    function newestWithin(log, maxChars) {
        let chars = 2;
        let start = log.length;
        while (start > 0) {
            chars += JSON.stringify(log[start - 1]).length + 1;
            if (chars > maxChars) break;
            start--;
        }
        return log.slice(start);
    }

    function createChatCopy(storage, now = Date.now) {
        function read() {
            try {
                const saved = JSON.parse(storage.getItem(KEY));
                if (saved && Array.isArray(saved.log) && now() - saved.savedAt < MAX_AGE_MS) return saved.log;
            } catch (error) { /* storage blocked or corrupt: no copy */ }
            return [];
        }

        function store(log) {
            try {
                storage.setItem(KEY, JSON.stringify({ savedAt: now(), log }));
                return true;
            } catch (error) { /* storage blocked or full */ }
            return false;
        }

        // Saves as much of the end of `log` as the storage takes. A failed write
        // leaves the previous value alone and successes only get longer, so the
        // last one is the longest that fits.
        function save(log) {
            if (store(log)) return;
            let lo = 1;
            let hi = log.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (store(log.slice(-mid))) lo = mid + 1;
                else hi = mid - 1;
            }
        }

        let copy = read();       // the whole log, kept in page memory too
        let current = [];        // the log the page shows
        let haveLog = false;     // has the server sent its log on this connection
        let restoreOpen = true;  // until the server says otherwise

        function remember(log) {
            copy = log.slice(); // not the page's own array, which keeps changing
            save(copy);
        }

        // The page's log has changed (`current`): keep the copy in step with it.
        function sync() {
            if (restoreOpen) {
                const merged = merge(copy, current);
                if (merged.length !== copy.length) remember(merged);
            } else {
                remember(current);
            }
        }

        return {
            // The server says whether it is still taking restore offers. It does so
            // on every connect, before sending its log.
            onRestoreStatus(open) {
                restoreOpen = open;
                if (haveLog) sync();
            },
            // The server sent its whole log (on connecting, or after a restore).
            // Returns the copy to offer back when the server lacks messages the
            // copy has and may still restore them, else null.
            onServerLog(log) {
                current = log;
                haveLog = true;
                if (!restoreOpen) {
                    remember(log);
                    return null;
                }
                const serverIds = new Set(log.map((m) => m.id));
                const missing = copy.some((m) => !serverIds.has(m.id));
                sync();
                return missing ? newestWithin(copy, MAX_OFFER_CHARS) : null;
            },
            // `log` is the page's full list after one more message was added.
            onMessageAdded(log) {
                current = log;
                sync();
            }
        };
    }

    return { createChatCopy, MAX_AGE_MS, MAX_OFFER_CHARS };
}));
