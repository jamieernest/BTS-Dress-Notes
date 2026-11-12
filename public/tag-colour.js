// Default colour for a new tag: the first palette colour no tag uses.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TagColour = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    // Same colours as default-tags.json.
    const PALETTE = ['#e63946', '#00b4d8', '#06d6a0', '#118ab2', '#8ac926', '#ff6f91'];
    const norm = c => {
        const hex = String(c).toLowerCase();
        return /^#[0-9a-f]{3}$/.test(hex) ? '#' + [...hex.slice(1)].map(x => x + x).join('') : hex;
    };
    function hsl(h) { // s 70%, l 50%
        const f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (0.5 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
        return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    function nextColour(used) {
        const taken = new Set(used.map(norm));
        const free = PALETTE.find(c => !taken.has(c));
        if (free) return free;
        // Palette exhausted: step the hue by the golden angle until unused.
        for (let i = taken.size; ; i++) {
            const c = hsl((i * 137.508) % 360);
            if (!taken.has(c)) return c;
        }
    }
    // Keeps `input` on an unused colour, except while a hand-picked one is showing.
    function createSuggester(input) {
        let picked = false, used = [];
        const suggest = () => { input.value = nextColour(used); };
        input.addEventListener('input', () => { picked = true; });
        return {
            update(colours) { used = colours; if (!picked) suggest(); },
            created() { picked = false; suggest(); }
        };
    }
    return { PALETTE, nextColour, createSuggester };
}));
