// Show identity and return navigation shared by live notes, Past notes and
// Playback. A locally opened notes file stays in this tab's session storage.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PlaybackContext = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const PREFIX = 'playback-file:';
    const BASE = 'http://notes.local';

    function newFileKey() {
        // randomUUID requires HTTPS; venue and Tailscale pages also use HTTP.
        const values = new Uint32Array(4);
        globalThis.crypto.getRandomValues(values);
        return Array.from(values, value => value.toString(16).padStart(8, '0')).join('');
    }

    function safeReturnTo(value, fallback = '/') {
        try {
            const url = new URL(value || fallback, BASE);
            if (url.origin === BASE && ['/', '/index.html', '/recall.html'].includes(url.pathname)) {
                return url.pathname + url.search + url.hash;
            }
        } catch (_) { /* use the known notes page */ }
        return fallback;
    }

    function notesUrl(source, noteId, returnTo) {
        const fallback = source.show ? `/recall.html?show=${encodeURIComponent(source.show)}`
            : source.file ? `/recall.html?file=${encodeURIComponent(source.file)}` : '/';
        const url = new URL(safeReturnTo(returnTo, fallback), BASE);
        if (noteId) url.hash = new URLSearchParams({ note: noteId }).toString();
        return url.pathname + url.search + url.hash;
    }

    function playbackUrl(source, noteId, returnTo) {
        const params = new URLSearchParams(source);
        if (noteId) params.set('note', noteId);
        if (returnTo) params.set('returnTo', safeReturnTo(returnTo));
        return `/playback.html?${params}`;
    }

    function saveFile(data, name, storage, id) {
        try {
            storage.setItem(PREFIX + id, JSON.stringify({ ...data, name }));
            return id;
        } catch (_) { return null; }
    }

    function readFile(id, storage) {
        try {
            const data = JSON.parse(storage.getItem(PREFIX + id));
            return data && Array.isArray(data.notes) ? data : null;
        } catch (_) { return null; }
    }

    // Progressive rendering means the requested note may arrive after the first batch.
    function restoreNote(list) {
        const id = new URLSearchParams(location.hash.slice(1)).get('note');
        if (!id) return;
        const find = () => {
            const el = list.querySelector(`[data-note-id="${CSS.escape(id)}"]`);
            if (!el) return false;
            el.classList.add('context-note');
            el.scrollIntoView({ block: 'center' });
            return true;
        };
        if (find()) return;
        const observer = new MutationObserver(() => { if (find()) observer.disconnect(); });
        observer.observe(list, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 30000);
    }

    return { safeReturnTo, notesUrl, playbackUrl, saveFile, readFile, restoreNote, newFileKey };
}));
