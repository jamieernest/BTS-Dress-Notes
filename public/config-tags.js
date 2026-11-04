(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.configTags = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    function validColor(value) {
        return /^#[0-9A-Fa-f]{6}$/.test(String(value || ''));
    }

    function payload(tag, name, color, command, suggestCommand) {
        const cleanName = String(name || '').trim();
        const cleanColor = String(color || '').trim();
        if (!cleanName || !validColor(cleanColor)) return null;
        const cleanCommand = String(command || '').trim() || suggestCommand(cleanName);
        return {
            ...(tag && tag.id ? { id: tag.id } : {}),
            name: cleanName,
            color: cleanColor,
            command: cleanCommand
        };
    }

    return { validColor, payload };
}));