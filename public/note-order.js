// Where a note belongs in the list, and how old a client says it is.
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

    return { MAX_AGE_MS, sanitizeAge, insertionIndex };
}));
