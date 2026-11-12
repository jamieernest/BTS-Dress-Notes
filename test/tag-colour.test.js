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
test('suggester tracks unused colours, keeps a hand-picked one, resumes after create', () => {
    const { createSuggester } = require('../public/tag-colour');
    let onInput;
    const input = { value: '', addEventListener: (_, f) => { onInput = f; } };
    const s = createSuggester(input);
    s.update([PALETTE[0]]);
    assert.equal(input.value, PALETTE[1]);
    s.update([PALETTE[0], PALETTE[1]]);
    assert.equal(input.value, PALETTE[2]);
    input.value = '#123456'; onInput();
    s.update([PALETTE[0], PALETTE[1], PALETTE[2]]);
    assert.equal(input.value, '#123456');
    s.created();
    assert.equal(input.value, PALETTE[3]);
});
