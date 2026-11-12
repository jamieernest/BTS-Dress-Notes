const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PALETTE, nextColour } = require('../public/tag-colour');
test('picks the first unused palette colour, ignoring case and short hex', () => {
    assert.equal(nextColour([]), PALETTE[0]);
    assert.equal(nextColour(['#E63946', '#00B4D8']), PALETTE[2]);
    assert.equal(nextColour(['#e63946', '#0bd']), PALETTE[1]);
});
test('generates distinct unused colours once the palette is taken', () => {
    const used = [...PALETTE];
    for (let i = 0; i < 20; i++) {
        const c = nextColour(used);
        assert.match(c, /^#[0-9a-f]{6}$/);
        assert.ok(!used.includes(c));
        used.push(c);
    }
});
