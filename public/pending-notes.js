// The browser's copy of the notes it has sent but the server has not yet
// acknowledged. Like the chat copy it lives in localStorage rather than page
// memory: a note written while the server or the Wi-Fi is down must survive a
// reload, a crashed tab or a bounce through /login, and is sent again once the
// page is back. The server ignores a resend whose clientId it already has.
//
// Each person's notes are kept under their own key (Keycloak sub), so someone
// else logging in on the same browser never sends them under their name.
// Every tab of theirs shares that key, so notes are added and removed one at a
// time: a tab writing its own list would wipe out another tab's unsent notes.
// A note older than MAX_AGE_MS is dropped: the server would date it no further
// back than that anyway (see note-order.js).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.createPendingNotes = factory().createPendingNotes;
}(typeof self !== 'undefined' ? self : this, function () {
    const PREFIX = 'pending-notes:';
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    function createPendingNotes(storage, now = Date.now) {
        // Storage can be missing, full or throw on access (private browsing);
        // the notes are then only kept for as long as the page.
        function read(sub) {
            try {
                const data = JSON.parse(storage.getItem(PREFIX + sub));
                return Array.isArray(data) ? data : [];
            } catch (e) {
                return [];
            }
        }

        // The pending notes saved for `sub`, oldest first: [{ note, writtenAt }].
        function load(sub) {
            if (!sub) return [];
            const cutoff = now() - MAX_AGE_MS;
            return read(sub).filter((p) => p && p.note && typeof p.note.clientId === 'string' &&
                typeof p.note.text === 'string' && typeof p.writtenAt === 'number' && p.writtenAt > cutoff);
        }

        function write(sub, entries) {
            try {
                if (entries.length === 0) storage.removeItem(PREFIX + sub);
                else storage.setItem(PREFIX + sub, JSON.stringify(entries.map(({ note, writtenAt }) => ({ note, writtenAt }))));
            } catch (e) { /* storage full or unavailable */ }
        }

        // Saves one pending note ({ note, writtenAt }) for `sub`.
        function add(sub, entry) {
            if (!sub || !entry || !entry.note) return;
            write(sub, [...load(sub).filter((p) => p.note.clientId !== entry.note.clientId), entry]);
        }

        // Forgets the pending note with `clientId` (stored or refused).
        function remove(sub, clientId) {
            if (!sub) return;
            write(sub, load(sub).filter((p) => p.note.clientId !== clientId));
        }

        // Forgets every pending note for `sub` (the notes were reset).
        function clear(sub) {
            if (sub) write(sub, []);
        }

        return { load, add, remove, clear };
    }

    return { createPendingNotes, MAX_AGE_MS };
}));
