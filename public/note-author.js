// Who may edit a note: the person who sent it.
//
// A note records its sender's Keycloak `sub` as userId. A note without one
// (written before authors were recorded, or restored from such a backup) has no
// owner and stays editable by anyone rather than being locked for everybody.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NoteAuthor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    function canEditNote(note, userId) {
        return !!note && (!note.userId || note.userId === userId);
    }

    return { canEditNote };
}));
