(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.tagCommands = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    function normalize(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function suggestTagCommand(name) {
        return normalize(name).replace(/\s+/g, '-');
    }

    function tagMatchesCommand(tag, command) {
        const commandKey = normalize(command);
        if (!commandKey) return false;
        return commandKey === normalize(tag.command || suggestTagCommand(tag.name) || tag.id);
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
        const result = consumeShitpostCommandAt(value);
        return result ? result.text : null;
    }

    function consumeShitpostCommandAt(value, cursor = String(value || '').length) {
        const source = String(value || '');
        const match = source.match(/(^|\s)\/shitpost(?=\s|$)/i);
        if (!match) return null;
        const tokenStart = match.index + match[1].length;
        const tokenEnd = tokenStart + '/shitpost'.length;
        const before = source.slice(0, tokenStart).replace(/\s+$/, '');
        const after = source.slice(tokenEnd);
        const text = before ? before + after : after.replace(/^\s+/, '');
        const position = Math.max(0, Math.min(Number(cursor) || 0, source.length));
        const rawPrefix = position <= tokenStart ? source.slice(0, position) : source.slice(tokenEnd, position);
        const cursorBeforeCommand = position <= tokenStart
            ? rawPrefix.replace(/\s+$/, '').length
            : before.length + (before ? rawPrefix : rawPrefix.replace(/^\s+/, '')).length;
        return {
            text,
            cursor: cursorBeforeCommand
        };
    }

    return { suggestTagCommand, consumeTagCommand, consumeShitpostCommand, consumeShitpostCommandAt };
}));
