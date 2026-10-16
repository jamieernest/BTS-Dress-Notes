// Putting text from other people (notes, comments, chat, names, tags) on the
// page without letting it run as HTML. Two layers, both always used:
//   - escapeHtml() for every value placed into an HTML template, and
//     safeColour() for a colour placed into a style attribute;
//   - setHtml() instead of assigning innerHTML, which runs the finished markup
//     through DOMPurify (vendor/purify.min.js, from node_modules), so a value
//     someone forgot to escape still cannot add a script or an event handler.
// Plain text needs neither: set textContent.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(root);
    else root.SafeHtml = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
    const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const HEX_COLOUR = /^#(?:[0-9a-f]{3}){1,2}$/i;

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (m) => htmlEscapes[m]);
    }

    // A #rgb/#rrggbb colour, or `fallback`: escaping alone does not stop
    // `red; background: url(...)` inside a style attribute.
    function safeColour(value, fallback = '#888888') {
        return typeof value === 'string' && HEX_COLOUR.test(value) ? value : fallback;
    }

    // Replaces `element`'s contents with the sanitized `html`. Fails closed: if
    // DOMPurify did not load, nothing is rendered rather than unsanitized markup.
    function setHtml(element, html) {
        if (!root.DOMPurify || typeof root.DOMPurify.sanitize !== 'function') {
            console.error('DOMPurify is not loaded; not rendering HTML.');
            element.textContent = '';
            return;
        }
        element.innerHTML = root.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }

    return { escapeHtml, safeColour, setHtml };
}));
