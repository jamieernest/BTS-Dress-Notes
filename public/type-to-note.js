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

    // Focus has moved out of the note box: 'cancel' when the box is empty and
    // focus went somewhere else on the page (a click or Tab away), else null.
    // Moving to the box's own tags or buttons, or to another window, keeps the
    // started note; text is never dropped this way.
    function leaveAction(ctx = {}) {
        if (String(ctx.noteValue || '').trim() !== '') return null;
        if (ctx.focusInComposer || !ctx.pageFocused) return null;
        return 'cancel';
    }

    // How long the note box may sit empty before its frozen timecode is let go.
    const EMPTY_RELEASE_MS = 5000;

    // The note box has been empty for EMPTY_RELEASE_MS: null (there is text, or
    // nothing is frozen), 'release' (still focused: unfreeze the timecode and
    // LX cue but keep the chosen tags; the next key freezes them again) or
    // 'cancel' (the box was left: drop the started note altogether).
    function emptyBoxAction(ctx = {}) {
        if (!ctx.isTyping || String(ctx.noteValue || '').trim() !== '') return null;
        return ctx.focused ? 'release' : 'cancel';
    }

    return { shouldFocusNote, isTextEntry, escapeAction, leaveAction, emptyBoxAction, EMPTY_RELEASE_MS };
}));
