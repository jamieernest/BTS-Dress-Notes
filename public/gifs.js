// Recognizes direct GIF links and renders them as bounded media inside chat
// bubbles. It does not fetch or proxy URLs: the browser loads only validated
// HTTP(S) image URLs and the CSP remains the final boundary.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.GifLinks = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const MAX_URL_LENGTH = 2048;

    function validUrl(value) {
        if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
        try {
            const url = new URL(value);
            if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
            if (!url.hostname) return null;
            return url;
        } catch (_) {
            return null;
        }
    }

    function isGifUrl(value) {
        const url = validUrl(value);
        if (!url) return false;
        if (/\.gif$/i.test(url.pathname)) return true;
        const host = url.hostname.toLowerCase();
        if ((host === 'giphy.com' || host.endsWith('.giphy.com')) &&
            (/^\/media(?:\/|$)/i.test(url.pathname) || /\/giphy\.gif$/i.test(url.pathname))) return true;
        if ((host === 'tenor.com' || host.endsWith('.tenor.com')) &&
            /\.gif$/i.test(url.pathname)) return true;
        return false;
    }

    function ranges(text) {
        const found = [];
        const pattern = /https?:\/\/[^\s<>"']+/gi;
        for (const match of String(text || '').matchAll(pattern)) {
            let value = match[0];
            while (/[.,!?;:\)\]\}]+$/.test(value)) value = value.slice(0, -1);
            if (!isGifUrl(value)) continue;
            if (found.some(item => item.start < match.index + value.length && item.end > match.index)) continue;
            found.push({ start: match.index, end: match.index + value.length, url: value });
        }
        return found;
    }

    function shiftedMentions(mentions, start, end) {
        if (!Array.isArray(mentions)) return [];
        return mentions.filter(m =>
            m && Number.isSafeInteger(m.start) && Number.isSafeInteger(m.end) &&
            m.start >= start && m.end <= end
        ).map(m => ({ ...m, start: m.start - start, end: m.end - start }));
    }

    function escapeHtml(value) {
        const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(value == null ? '' : value).replace(/[&<>"']/g, m => escapes[m]);
    }

    function html(text, mentions = [], mentionRenderer = null) {
        text = String(text || '');
        const gifRanges = ranges(text);
        if (!gifRanges.length) {
            return mentionRenderer ? `<div class="chat-msg-text">${mentionRenderer(text, mentions)}</div>` : `<div class="chat-msg-text">${escapeHtml(text)}</div>`;
        }

        let at = 0;
        let textHtml = '';
        for (const range of gifRanges) {
            const segment = text.slice(at, range.start);
            if (segment.trim()) {
                const shifted = shiftedMentions(mentions, at, range.start);
                textHtml += mentionRenderer ? mentionRenderer(segment, shifted) : escapeHtml(segment);
            }
            at = range.end;
        }
        const tail = text.slice(at);
        if (tail.trim()) {
            const shifted = shiftedMentions(mentions, at, text.length);
            textHtml += mentionRenderer ? mentionRenderer(tail, shifted) : escapeHtml(tail);
        }

        const mediaHtml = gifRanges.map(range =>
            `<img class="chat-gif" src="${escapeHtml(range.url)}" alt="GIF" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
        ).join('');
        return `${textHtml.trim() ? `<div class="chat-msg-text">${textHtml}</div>` : ''}<div class="chat-gifs">${mediaHtml}</div>`;
    }

    return { validUrl, isGifUrl, ranges, html };
}));
