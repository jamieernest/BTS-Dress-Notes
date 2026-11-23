// Recognizes exact shared-sticker URLs and renders them as bounded chat images.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Stickers = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const ID = /^[a-f0-9]{32}$/;

    function stickerUrl(value) {
        if (typeof value !== 'string' || value.length > 300) return null;
        const match = /^\/stickers\/([a-f0-9]{32})$/.exec(value);
        return match && ID.test(match[1]) ? value : null;
    }

    function isStickerUrl(value) {
        return stickerUrl(value) !== null;
    }

    function escapeHtml(value) {
        const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(value == null ? '' : value).replace(/[&<>"']/g, m => escapes[m]);
    }

    function html(text) {
        const url = stickerUrl(text);
        if (!url) return '';
        return `<img class="chat-sticker" src="${escapeHtml(url)}" alt="Sticker" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
    }

    return { stickerUrl, isStickerUrl, html };
}));
