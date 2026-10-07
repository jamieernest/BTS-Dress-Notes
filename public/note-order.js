// Where a note belongs in the list, which end of the list is shown first, and how old a client says it is.
//
// A note written while the browser was disconnected reaches the server late.
// Browser clocks cannot be trusted to agree with the server's, so the browser
// sends the note's age (ms since it was written) and the server stamps it with
// its own clock minus that age. The list is kept in stamp order; a note goes
// after every note with an equal or earlier stamp, so equal stamps keep the
// order they arrived in. Timecode is not used: it can jump back when a section
// is run again.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NoteOrder = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    // Untrusted input: anything but a finite, non-negative number up to MAX_AGE_MS counts as 0.
    function sanitizeAge(ageMs) {
        if (typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_AGE_MS) return 0;
        return ageMs;
    }

    function stampMs(note) {
        const ms = Date.parse(note && note.timestamp);
        return Number.isNaN(ms) ? null : ms;
    }

    // Index at which to insert `note` into `notes` (ordered by timestamp).
    function insertionIndex(notes, note) {
        const ms = stampMs(note);
        if (ms === null) return notes.length;
        let i = notes.length;
        while (i > 0) {
            const prev = stampMs(notes[i - 1]);
            if (prev === null || prev <= ms) break;
            i--;
        }
        return i;
    }

    function timecodeSeconds(tc) {
        if (!tc) return 0;
        return (tc.hours || 0) * 3600 + (tc.minutes || 0) * 60 + (tc.seconds || 0) + (tc.frames || 0) / (tc.frameRate || 30);
    }

    // The order a note list is shown in: newest at the top. Stamp order (timecode when a note has no
    // stamp) reversed, so notes with equal stamps show the later arrival first. The server's array is
    // never reordered: storage, backups and the JSON export stay oldest first.
    function newestFirst(notes) {
        return notes
            .map((note, i) => ({ note, i }))
            .sort((a, b) => {
                const x = stampMs(a.note);
                const y = stampMs(b.note);
                const diff = x !== null && y !== null ? y - x : timecodeSeconds(b.note.timecode) - timecodeSeconds(a.note.timecode);
                return diff || b.i - a.i;
            })
            .map(({ note }) => note);
    }

    return { MAX_AGE_MS, sanitizeAge, insertionIndex, newestFirst };
}));
