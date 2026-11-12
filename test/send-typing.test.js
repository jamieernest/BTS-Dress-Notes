// Regression: after Send the composer must tell the server typing stopped (the send handler used to clear
// isTyping locally after focus() had restarted it, leaving the person shown as typing until reload).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('the send handler releases typing through releaseFreeze, never by clearing isTyping alone', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8');
    const handler = src.slice(src.indexOf("sendNoteBtn.addEventListener('click'"), src.indexOf("cancelNoteBtn.addEventListener('mousedown'"));
    assert.ok(handler.length > 100);
    assert.doesNotMatch(handler, /currentUser\.isTyping = false/);
    assert.ok(handler.lastIndexOf('releaseFreeze()') > handler.indexOf('noteInput.focus()'), 'release must come after focus() restarts typing');
});
