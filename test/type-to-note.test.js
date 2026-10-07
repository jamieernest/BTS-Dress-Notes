const test = require('node:test');
const assert = require('node:assert');
const { shouldFocusNote } = require('../public/type-to-note');

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
