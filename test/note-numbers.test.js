const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../public/note-numbers');
const input = require('../note-input');
const V = require('../public/note-view');
const note = (id, extra = {}) => ({ id, text: id, timestamp: `2026-11-05T10:00:0${id}Z`, tags: [], ...extra });

test('legacy migration is oldest first, deterministic and preserves assigned references', () => {
    const notes = [note('3'), note('1'), note('2')];
    assert.equal(N.migrate(notes), 4);
    assert.deepEqual(notes.map(n => n.noteNumber), [3, 1, 2]);
    assert.equal(N.migrate(notes), 4);
    const mixed = [note('1', { noteNumber: 5 }), note('2', { noteNumber: 5 }), note('3', { noteNumber: '<script>' })];
    assert.equal(N.migrate(mixed, 10), 12);
    assert.deepEqual(mixed.map(n => n.noteNumber), [5, 10, 11]);
});

test('sanitization and JSON roundtrip retain numbers and high-watermark', () => {
    const data = JSON.parse(JSON.stringify({ notes: [note('1', { noteNumber: 4 })], nextNoteNumber: 20 }));
    const notes = input.cleanStoredNotes(data.notes);
    assert.equal(notes[0].noteNumber, 4);
    assert.equal(N.migrate(notes, data.nextNoteNumber), 20);
    assert.equal(N.migrate([], data.nextNoteNumber), 20);
    assert.equal(input.cleanStoredNotes([note('1', { noteNumber: '4' })])[0].noteNumber, undefined);
});

test('reset merges reserve incoming references and never reuse deleted live references', () => {
    const added = [note('1', { noteNumber: 1 }), note('2', { noteNumber: 10 }), note('3', { noteNumber: 10 })];
    const next = N.merge(added, 8, 15);
    assert.deepEqual(added.map(n => n.noteNumber), [15, 10, 16]);
    assert.equal(next, 17);
});

test('compact references render safely, pending notes have none and number search is exact', () => {
    const n = note('1', { noteNumber: 123 });
    assert.match(V.noteHTML(n), />#123<\/span>/);
    assert.doesNotMatch(V.noteHTML(note('1')), /note-reference/);
    assert.doesNotMatch(V.noteHTML(note('1', { noteNumber: '<img>' })), /note-reference/);
    const matches = search => V.noteMatches(n, { tag: 'all', act: 'all', search }, () => ({}));
    assert.equal(matches('#123'), true);
    assert.equal(matches('123'), true);
    assert.equal(matches('#12'), false);
});
