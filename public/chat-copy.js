// The browser's copy of the chat log, offered back to a restarted server (see
// chat-restore.js). It is kept in localStorage rather than page memory because
// people reload, or are bounced through /login, while the server is down, and
// a copy that dies with the page is gone before the server is back. Copies
// older than MAX_AGE_MS are dropped so a server restarted for a new show does
// not get an old show's chat back.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.createChatCopy = factory().createChatCopy;
}(typeof self !== 'undefined' ? self : this, function () {
    const KEY = 'chat-log-copy';
    const MAX_AGE_MS = 12 * 60 * 60 * 1000; // same as the login session

    function createChatCopy(storage, now = Date.now) {
        function read() {
            try {
                const saved = JSON.parse(storage.getItem(KEY));
                if (saved && Array.isArray(saved.log) && now() - saved.savedAt < MAX_AGE_MS) return saved.log;
            } catch (error) { /* storage blocked or corrupt: no copy */ }
            return [];
        }

        let copy = read();

        function remember(log) {
            copy = log;
            try {
                storage.setItem(KEY, JSON.stringify({ savedAt: now(), log }));
            } catch (error) { /* storage blocked or full: page memory still works */ }
        }

        return {
            // The server sent its whole log. Returns the copy to offer back if the
            // server's log is empty (it restarted), else remembers the new log.
            onServerLog(log) {
                if (log.length === 0) return copy.length > 0 ? copy : null;
                remember(log);
                return null;
            },
            // `log` is the full list after one more message was added.
            onMessageAdded(log) {
                remember(log.slice(-100));
            }
        };
    }

    return { createChatCopy, MAX_AGE_MS };
}));
