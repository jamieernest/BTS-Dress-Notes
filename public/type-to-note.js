// Decides whether a key press on the main page should move focus into the note
// box so the person can just start typing. The character itself is not
// handled here: focusing during keydown lets the browser deliver it to the note
// box, so it lands once.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.typeToNote = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    // Inputs that do not take typed text; a letter pressed on one of these
    // (e.g. a tag checkbox that was just clicked) should still go to the note.
    const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image']);

    function isTextEntry(el) {
        if (!el || el.nodeType !== 1) return false;
        const tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type || 'text').toLowerCase());
        return !!el.isContentEditable || el.getAttribute('role') === 'textbox';
    }

    // `ctx.modalOpen` is true while a dialog is showing. Space is only taken
    // when nothing at all is focused (it would otherwise toggle a focused
    // checkbox or press a button, or scroll the page); Backspace never is.
    function shouldFocusNote(e, activeElement, ctx = {}) {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return false;
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        if (typeof e.key !== 'string' || e.key.length !== 1) return false; // named keys: Enter, arrows, F-keys, Tab...
        if (ctx.modalOpen) return false;
        if (isTextEntry(activeElement)) return false;
        const nothingFocused = !activeElement || activeElement === ctx.body;
        if (e.key === ' ' && !nothingFocused) return false;
        if (e.key === ' ' && !ctx.noteHasText) return false;
        return true;
    }

    // Escape in the note box: 'cancel' (box empty: drop the started note and
    // release the frozen timecode), 'blur' (has text: only leave the box, so a
    // slipped finger cannot discard it) or null (not ours to handle).
    function escapeAction(e, activeElement, ctx = {}) {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null;
        if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
        if (ctx.modalOpen || !activeElement || activeElement !== ctx.noteInput) return null;
        return String(ctx.noteValue || '').trim() === '' ? 'cancel' : 'blur';
    }

    // How long an empty note box may stay unfocused before its frozen timecode
    // is released. Short enough that clicking in and wandering off does not hold
    // the timecode, long enough to click a tag or reach for the box again.
    const AUTO_RELEASE_MS = 3000;

    // Whether the unfocused-note timer should release the frozen timecode and
    // drop the started note: only when nothing has been put into it. Text or a
    // chosen tag means the person has started a note, so it is kept, as with
    // Escape on a note that has text.
    function shouldAutoRelease(ctx = {}) {
        if (ctx.noteFocused) return false;
        return String(ctx.noteValue || '').trim() === '' && !ctx.tagsSelected;
    }

    return { shouldFocusNote, isTextEntry, escapeAction, shouldAutoRelease, AUTO_RELEASE_MS };
}));
