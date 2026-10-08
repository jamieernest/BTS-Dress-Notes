const test = require('node:test');
const assert = require('node:assert');
const { shouldFocusNote, escapeAction } = require('../public/type-to-note');

const body = { nodeType: 1, tagName: 'BODY', getAttribute: () => null };
const el = (tagName, extra = {}) => ({ nodeType: 1, tagName, getAttribute: () => null, ...extra });
const key = (k, extra = {}) => ({ key: k, ...extra });
const ctx = (extra = {}) => ({ body, noteHasText: false, modalOpen: false, ...extra });

test('a character with nothing focused goes to the note box', () => {
    assert.ok(shouldFocusNote(key('a'), body, ctx()));
    assert.ok(shouldFocusNote(key('A', { shiftKey: true }), null, ctx()));
    assert.ok(shouldFocusNote(key('5'), body, ctx()));
    assert.ok(shouldFocusNote(key('é'), body, ctx()));
});

test('a character on a button, link or checkbox still goes to the note box', () => {
    assert.ok(shouldFocusNote(key('a'), el('BUTTON'), ctx()));
    assert.ok(shouldFocusNote(key('a'), el('A'), ctx()));
    assert.ok(shouldFocusNote(key('a'), el('INPUT', { type: 'checkbox' }), ctx()));
});

test('places where someone is already typing or choosing are left alone', () => {
    assert.ok(!shouldFocusNote(key('a'), el('TEXTAREA'), ctx())); // chat, comments, note edits, note box
    assert.ok(!shouldFocusNote(key('a'), el('INPUT', { type: 'text' }), ctx()));
    assert.ok(!shouldFocusNote(key('a'), el('INPUT', {}), ctx()));
    assert.ok(!shouldFocusNote(key('a'), el('INPUT', { type: 'search' }), ctx()));
    assert.ok(!shouldFocusNote(key('a'), el('SELECT'), ctx()));
    assert.ok(!shouldFocusNote(key('a'), el('DIV', { isContentEditable: true }), ctx()));
    assert.ok(!shouldFocusNote(key('a'), el('DIV', { getAttribute: (n) => (n === 'role' ? 'textbox' : null) }), ctx()));
});

test('nothing is taken while a modal is open', () => {
    assert.ok(!shouldFocusNote(key('a'), body, ctx({ modalOpen: true })));
});

test('shortcuts and non-typing keys are ignored', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.ok(!shouldFocusNote(key('c', { [mod]: true }), body, ctx()));
    for (const k of ['Enter', 'Escape', 'Tab', 'ArrowDown', 'PageUp', 'Home', 'F5', 'Shift', 'Control', 'Backspace', 'Delete', 'Dead']) {
        assert.ok(!shouldFocusNote(key(k), body, ctx()), k);
    }
});

test('composition and already-handled keys are ignored', () => {
    assert.ok(!shouldFocusNote(key('a', { isComposing: true }), body, ctx()));
    assert.ok(!shouldFocusNote(key('Process', { keyCode: 229 }), body, ctx()));
    assert.ok(!shouldFocusNote(key('a', { defaultPrevented: true }), body, ctx()));
});

test('space only counts when nothing is focused and the note already has text', () => {
    assert.ok(!shouldFocusNote(key(' '), body, ctx()));
    assert.ok(shouldFocusNote(key(' '), body, ctx({ noteHasText: true })));
    assert.ok(!shouldFocusNote(key(' '), el('BUTTON'), ctx({ noteHasText: true })));
    assert.ok(!shouldFocusNote(key(' '), el('INPUT', { type: 'checkbox' }), ctx({ noteHasText: true })));
});

test('Escape in the note box cancels an empty note and only leaves a written one', () => {
    const noteInput = el('TEXTAREA');
    const esc = (value, extra, over) => escapeAction(key('Escape', extra), noteInput, { noteInput, noteValue: value, ...over });
    assert.equal(esc(''), 'cancel');
    assert.equal(esc('  \n '), 'cancel');
    assert.equal(esc('hello'), 'blur');
});

test('Escape is left alone elsewhere', () => {
    const noteInput = el('TEXTAREA');
    const other = el('TEXTAREA');
    assert.equal(escapeAction(key('Escape'), other, { noteInput, noteValue: '' }), null); // chat, comment, edit
    assert.equal(escapeAction(key('Escape'), body, { noteInput, noteValue: '' }), null);
    assert.equal(escapeAction(key('Escape'), noteInput, { noteInput, noteValue: '', modalOpen: true }), null);
    assert.equal(escapeAction(key('Escape', { defaultPrevented: true }), noteInput, { noteInput, noteValue: '' }), null);
    assert.equal(escapeAction(key('Escape', { isComposing: true }), noteInput, { noteInput, noteValue: '' }), null);
    assert.equal(escapeAction(key('a'), noteInput, { noteInput, noteValue: '' }), null);
});

test('an unfocused note box is released only while it has nothing in it', () => {
    const { shouldAutoRelease, AUTO_RELEASE_MS } = require('../public/type-to-note');
    assert.strictEqual(shouldAutoRelease({ noteValue: '', tagsSelected: false, noteFocused: false }), true);
    assert.strictEqual(shouldAutoRelease({ noteValue: '   \n', tagsSelected: false, noteFocused: false }), true);
    assert.strictEqual(shouldAutoRelease({ noteValue: 'half a note', tagsSelected: false, noteFocused: false }), false);
    assert.strictEqual(shouldAutoRelease({ noteValue: '', tagsSelected: true, noteFocused: false }), false);
    assert.strictEqual(shouldAutoRelease({ noteValue: '', tagsSelected: false, noteFocused: true }), false);
    assert.ok(AUTO_RELEASE_MS >= 1000 && AUTO_RELEASE_MS <= 5000, 'a few seconds, not ~15');
});
