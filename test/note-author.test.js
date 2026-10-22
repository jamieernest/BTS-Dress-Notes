const test = require('node:test');
const assert = require('node:assert');
const { canEditNote } = require('../public/note-author');

test('only the author may edit a note', () => {
    assert.strictEqual(canEditNote({ userId: 'alice' }, 'alice'), true);
    assert.strictEqual(canEditNote({ userId: 'alice' }, 'bob'), false);
    assert.strictEqual(canEditNote({ userId: 'alice' }, undefined), false);
});

test('a note with no recorded author stays editable by anyone', () => {
    assert.strictEqual(canEditNote({}, 'bob'), true);
    assert.strictEqual(canEditNote({ userId: '' }, 'bob'), true);
});

test('a missing note is not editable', () => {
    assert.strictEqual(canEditNote(undefined, 'bob'), false);
});
