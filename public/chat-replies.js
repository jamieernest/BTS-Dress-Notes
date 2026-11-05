// Reply context is resolved from one flat log, never copied into a message.
// Kept separate from text rendering so mentions can share the composer later.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ChatReplies = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    function validId(id) {
        return typeof id === 'string' && id.length > 0 && id.length <= 64 && !/[\s\x00-\x1f\x7f]/.test(id);
    }
    function context(id, messages) {
        const target = validId(id) ? messages.get(id) : null;
        return target ? `${target.user}: ${target.text}`.replace(/\s+/g, ' ').slice(0, 180)
            : 'Original message unavailable';
    }
    return { validId, context };
}));
