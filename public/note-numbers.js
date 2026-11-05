// Human references belong to a show; UUIDs remain the identity for every action.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NoteNumbers = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const valid = n => Number.isSafeInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER;
    const counter = n => Number.isSafeInteger(n) && n > 0;
    const label = note => valid(note.noteNumber) ? `#${note.noteNumber}` : '';

    // Mutates notes, preserving the first occurrence of every valid reference.
    // Legacy/malformed references are assigned deterministically oldest first.
    // The counter, including gaps from deleted notes, is persisted separately.
    function migrate(notes, nextNoteNumber = 1) {
        let next = counter(nextNoteNumber) ? nextNoteNumber : 1;
        const used = new Set();
        const missing = [];
        const ordered = notes.map((note, i) => ({ note, i })).sort((a, b) =>
            (Date.parse(a.note.timestamp) || 0) - (Date.parse(b.note.timestamp) || 0) || a.i - b.i);
        for (const { note } of ordered) {
            if (valid(note.noteNumber) && !used.has(note.noteNumber)) {
                used.add(note.noteNumber);
                next = Math.max(next, note.noteNumber + 1);
            } else missing.push(note);
        }
        for (const note of missing) {
            if (!valid(next)) throw new Error('Note numbers exhausted');
            note.noteNumber = next++;
        }
        return next;
    }

    // Incoming reset notes join a running show. Never reuse any reference below
    // its high-watermark, even when the corresponding live note was deleted.
    function merge(added, nextNoteNumber, incomingNext = 1) {
        for (const note of added) {
            if (!valid(note.noteNumber) || note.noteNumber < nextNoteNumber) delete note.noteNumber;
        }
        return migrate(added, Math.max(nextNoteNumber, counter(incomingNext) ? incomingNext : 1));
    }
    return { valid, counter, label, migrate, merge };
}));
