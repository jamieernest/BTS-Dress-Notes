// The latest explicit selection wins across drafts and tabs. Keep the existing
// last-tags key so selections saved by earlier versions carry forward.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.createComposerTags = factory().createComposerTags;
}(typeof self !== 'undefined' ? self : this, function () {
    function createComposerTags(storage) {
        const memory = new Map();
        const key = (sub) => `last-tags:${sub}`;
        const clean = (tags) => Array.isArray(tags) ? tags.filter(id => typeof id === 'string') : [];
        function load(sub) {
            if (!sub) return [];
            try {
                const value = storage.getItem(key(sub));
                if (value !== null) memory.set(sub, clean(JSON.parse(value)));
            } catch (e) { /* use this tab's selection if storage is unavailable */ }
            return [...(memory.get(sub) || [])];
        }
        function save(sub, tags) {
            if (!sub) return;
            const selection = clean(tags);
            memory.set(sub, selection);
            try { storage.setItem(key(sub), JSON.stringify(selection)); } catch (e) { /* storage unavailable */ }
        }
        function reconcile(sub, available) {
            const ids = new Set(available.map(tag => tag.id));
            const previous = load(sub);
            const next = previous.filter(id => ids.has(id));
            if (next.length !== previous.length) save(sub, next);
            return next;
        }
        return { key, load, save, reconcile };
    }
    return { createComposerTags };
}));
