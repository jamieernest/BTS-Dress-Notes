// The notes as this tab last showed them, so coming back to the main page (from
// past notes, settings, a reload) draws them at once instead of after the
// socket has connected. It is only a head start: the server sends the full
// list on every connect and that always replaces it.
//
// Kept in sessionStorage, so it is per tab and gone when the tab closes, and
// with who it was for (Keycloak sub) so edit buttons are right from the start;
// a different person's login is corrected by `current-user`. Logging out
// clears it. A snapshot older than MAX_AGE_MS is ignored.
//
// It also keeps the top bar as it was (`live`: who was online, cue, scene,
// clock mode and last timecodes), so a reload doesn't flash defaults there
// either. Like the notes, the server's values replace it on connect.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.createNotesSnapshot = factory().createNotesSnapshot;
}(typeof self !== 'undefined' ? self : this, function () {
    const KEY = 'notes-snapshot';
    const MAX_AGE_MS = 12 * 60 * 60 * 1000;

    const TIME_MODES = ['midi', 'network', 'realtime'];
    const isTimecode = (t) => !!t && typeof t === 'object' &&
        ['hours', 'minutes', 'seconds', 'frames', 'frameRate'].every((k) => Number.isFinite(t[k]));

    // The top bar's state, or null if any of it is missing or the wrong shape.
    function cleanLive(live) {
        if (!live || typeof live !== 'object') return null;
        const { users, act, cue, timeMode, oscAvailable, timecodes, liveSources } = live;
        if (!Array.isArray(users) || typeof act !== 'string' || typeof cue !== 'string' ||
            !TIME_MODES.includes(timeMode) || typeof oscAvailable !== 'boolean' ||
            !timecodes || !isTimecode(timecodes.midi) || !isTimecode(timecodes.network) ||
            !liveSources || typeof liveSources !== 'object') return null;
        return {
            users: users.filter((u) => u && typeof u.id === 'string' && typeof u.name === 'string')
                .map((u) => ({ id: u.id, name: u.name })),
            act,
            cue,
            timeMode,
            oscAvailable,
            unreadChat: Number.isSafeInteger(live.unreadChat) && live.unreadChat > 0 ? live.unreadChat : 0,
            timecodes: { midi: timecodes.midi, network: timecodes.network },
            liveSources: { midi: liveSources.midi === true, network: liveSources.network === true }
        };
    }

    function createNotesSnapshot(storage, now = Date.now) {
        // Storage can be missing, full or throw on access (private browsing);
        // the page then just waits for the server as before.
        function load() {
            let data;
            try {
                data = JSON.parse(storage.getItem(KEY));
            } catch (e) {
                return null;
            }
            if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) return null;
            if (typeof data.savedAt !== 'number' || !(data.savedAt > now() - MAX_AGE_MS) || data.savedAt > now()) return null;
            if (typeof data.sub !== 'string' || typeof data.name !== 'string') return null;
            const notes = data.notes.filter((n) => n && typeof n === 'object' && typeof n.id === 'string' &&
                typeof n.text === 'string' && typeof n.timestamp === 'string');
            return { sub: data.sub, name: data.name, notes, live: cleanLive(data.live) };
        }

        // Only saved once the server has said who is logged in.
        function save({ sub, name, notes, live }) {
            if (!sub) return;
            try {
                storage.setItem(KEY, JSON.stringify({ savedAt: now(), sub, name: name || '', notes, live: cleanLive(live) }));
            } catch (e) {
                // Full: drop the old one rather than leave it to go stale.
                clear();
            }
        }

        function clear() {
            try { storage.removeItem(KEY); } catch (e) { /* unavailable */ }
        }

        return { load, save, clear };
    }

    return { createNotesSnapshot, MAX_AGE_MS };
}));
