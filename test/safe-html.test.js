const test = require('node:test');
const assert = require('node:assert');
const { escapeHtml, safeColour } = require('../public/safe-html.js');

test('escapeHtml makes text safe in element content and in quoted attributes', () => {
    assert.strictEqual(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.strictEqual(escapeHtml("it's & done"), 'it&#39;s &amp; done');
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(12), '12');
});

test('only hex colours reach a style attribute', () => {
    assert.strictEqual(safeColour('#E63946'), '#E63946');
    assert.strictEqual(safeColour('#abc'), '#abc');
    for (const bad of ['red;background:url(//evil.example)', 'red', '#12345', null, undefined, {}]) {
        assert.strictEqual(safeColour(bad), '#888888');
    }
});

test('setHtml renders nothing if DOMPurify is missing', () => {
    const element = { innerHTML: 'old', textContent: 'old' };
    const errors = [];
    const original = console.error;
    console.error = (msg) => errors.push(msg);
    try {
        // Loaded fresh against a global object without DOMPurify.
        const factorySelf = {};
        const source = require('node:fs').readFileSync(require.resolve('../public/safe-html.js'), 'utf8');
        new Function('self', 'module', source)(factorySelf, undefined);
        factorySelf.SafeHtml.setHtml(element, '<b onclick="x">hi</b>');
    } finally {
        console.error = original;
    }
    assert.strictEqual(element.textContent, '');
    assert.strictEqual(element.innerHTML, 'old', 'the unsanitized markup was not assigned');
    assert.strictEqual(errors.length, 1);
});
