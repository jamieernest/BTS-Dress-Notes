// One width preference drives the drawer and the notes area beside it.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ChatResize = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const KEY = 'shitposts-width';
    const DEFAULT_WIDTH = 420;
    const MIN_WIDTH = 320;
    const MAX_WIDTH = 800;
    const MIN_NOTES_WIDTH = 480;
    const DESKTOP_MIN = 861;

    function preferredWidth(raw) {
        const width = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
        return typeof width === 'number' && Number.isFinite(width) && width > 0
            ? Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))) : DEFAULT_WIDTH;
    }
    function readPreference(storage) {
        try { return preferredWidth((storage || globalThis.localStorage).getItem(KEY)); }
        catch (_) { return DEFAULT_WIDTH; }
    }
    function limits(viewportWidth) {
        return { min: MIN_WIDTH, max: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth) - MIN_NOTES_WIDTH)) };
    }
    function clampWidth(preferred, viewportWidth) {
        const { min, max } = limits(viewportWidth);
        const desired = typeof preferred === 'number' && Number.isFinite(preferred) ? preferred : preferredWidth(preferred);
        return Math.round(Math.max(min, Math.min(max, desired)));
    }
    function createChatResize({ separator, drawer, root = document.documentElement, win = window,
        storage, onChange = () => {}, onStart = () => {} }) {
        let preferred = readPreference(storage);
        let width;
        let drag = null;
        const enabled = () => win.innerWidth >= DESKTOP_MIN && !drawer.hidden;
        const viewportWidth = () => win.document?.documentElement?.clientWidth || win.innerWidth;
        function persist() {
            try { (storage || globalThis.localStorage).setItem(KEY, String(preferred)); }
            catch (_) { /* Resizing still works when browser storage is unavailable. */ }
        }
        function apply() {
            const range = limits(viewportWidth());
            const next = clampWidth(preferred, viewportWidth());
            separator.setAttribute('aria-valuemin', String(range.min));
            separator.setAttribute('aria-valuemax', String(range.max));
            separator.setAttribute('aria-valuenow', String(next));
            separator.setAttribute('aria-valuetext', `${next} pixels wide`);
            separator.setAttribute('aria-disabled', String(!enabled()));
            separator.tabIndex = enabled() ? 0 : -1;
            if (next === width) return;
            width = next;
            root.style.setProperty('--chat-width', `${width}px`);
            onChange();
        }
        function finish(cancelled = false) {
            if (!drag) return;
            const previous = drag;
            drag = null;
            root.classList.remove('chat-resizing');
            if (separator.hasPointerCapture?.(previous.pointerId)) separator.releasePointerCapture(previous.pointerId);
            if (cancelled) { preferred = previous.preferred; apply(); }
            else persist();
        }
        function refresh() {
            if (!enabled()) finish(true);
            apply(); // Viewport clamps never overwrite the person's preferred width.
        }
        function pointerdown(event) {
            if (!enabled() || event.button !== 0 || event.isPrimary === false) return;
            event.preventDefault(); // Keep a draft's focus/caret in place while dragging.
            if (!win.document?.activeElement?.matches?.('input, textarea, [contenteditable="true"]')) separator.focus?.({ preventScroll: true });
            onStart();
            drag = { pointerId: event.pointerId, x: event.clientX, width, preferred };
            separator.setPointerCapture(event.pointerId);
            root.classList.add('chat-resizing');
        }
        function pointermove(event) {
            if (!drag || event.pointerId !== drag.pointerId) return;
            preferred = clampWidth(drag.width + drag.x - event.clientX, viewportWidth());
            apply();
        }
        function pointerup(event) { if (drag && event.pointerId === drag.pointerId) finish(); }
        function pointercancel(event) { if (drag && event.pointerId === drag.pointerId) finish(true); }
        function cancel() { finish(true); }
        function escape(event) {
            if (event.key !== 'Escape' || !drag) return;
            event.preventDefault(); event.stopImmediatePropagation(); finish(true);
        }
        function keydown(event) {
            if (!enabled() || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
            const range = limits(viewportWidth());
            const step = event.shiftKey ? 64 : 16;
            const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: range.min, End: range.max }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            onStart();
            preferred = clampWidth(next, viewportWidth());
            apply(); persist();
        }
        function storageChanged(event) {
            if (event.key !== KEY || drag) return;
            preferred = preferredWidth(event.newValue); apply();
        }
        const events = { pointerdown, pointermove, pointerup, pointercancel, lostpointercapture: pointercancel, keydown };
        for (const [name, callback] of Object.entries(events)) separator.addEventListener(name, callback);
        win.addEventListener('resize', refresh);
        win.addEventListener('blur', cancel);
        win.addEventListener('storage', storageChanged);
        // Escape can cancel a pointer drag while focus remains in a draft.
        win.addEventListener('keydown', escape, true);
        apply();
        return { refresh, destroy() {
            finish(true);
            for (const [name, callback] of Object.entries(events)) separator.removeEventListener(name, callback);
            win.removeEventListener('resize', refresh);
            win.removeEventListener('blur', cancel);
            win.removeEventListener('storage', storageChanged);
            win.removeEventListener('keydown', escape, true);
        } };
    }
    return { KEY, DEFAULT_WIDTH, DESKTOP_MIN, readPreference, preferredWidth, limits, clampWidth, createChatResize };
}));
