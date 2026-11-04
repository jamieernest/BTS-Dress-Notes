(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.tagCommands = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    function normalize(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function tagMatchesCommand(tag, command) {
        const commandKey = normalize(command);
        if (!commandKey) return false;
        // An explicit command replaces the id/name matches; leave the old matches for older tags.
        if (tag.command) return commandKey === normalize(tag.command);
        const id = normalize(tag.id);
        const name = normalize(tag.name);
        return commandKey === id || commandKey === name || name.split(' ').includes(commandKey);
    }

    function consumeTagCommand(value, tags, cursor = String(value || '').length) {
        const text = String(value || '');
        const commandPattern = /(^|\s)\/([a-z0-9][a-z0-9_-]*)(?=\s|$)/gi;
        let match;
        while ((match = commandPattern.exec(text))) {
            const tokenStart = match.index + match[1].length;
            const tokenEnd = tokenStart + match[0].length - match[1].length;
            if (tokenEnd > cursor) continue;
            const tag = (Array.isArray(tags) ? tags : []).find(candidate => tagMatchesCommand(candidate, match[2]));
            if (!tag) continue;

            const before = text.slice(0, tokenStart);
            let after = text.slice(tokenEnd);
            if (before.endsWith(' ') && after.startsWith(' ')) after = after.slice(1);
            if (!before) after = after.replace(/^\s/, '');
            return {
                tagId: tag.id,
                value: before + after,
                cursor: Math.max(0, cursor - (text.length - before.length - after.length))
            };
        }
        return null;
    }

    function consumeShitpostCommand(value) {
        // A standalone /shitpost removes itself and sends the remaining draft text to chat.
        const source = String(value || '');
        const match = source.match(/(^|\s)\/shitpost(?=\s|$)/i);
        if (!match) return null;
        const before = source.slice(0, match.index);
        const after = source.slice(match.index + match[0].length);
        const text = `${before} ${after}`.replace(/\s+/g, ' ').trim();
        return text || null;
    }

    return { consumeTagCommand, consumeShitpostCommand };
}));