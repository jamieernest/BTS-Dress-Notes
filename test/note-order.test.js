// The notes list shows the newest note at the top; the stored order (and so the export) stays oldest first.
const test = require('node:test');
const assert = require('node:assert');
const { newestFirst } = require('../public/note-order');

const at = (id, iso, extra = {}) => ({ id, timestamp: iso, ...extra });

test('newestFirst puts the latest stamp at the top without touching the input', () => {
    const stored = [at('a', '2026-01-01T10:00:00.000Z'), at('b', '2026-01-01T10:00:01.000Z'), at('c', '2026-01-01T10:00:02.000Z')];
    assert.deepStrictEqual(newestFirst(stored).map((n) => n.id), ['c', 'b', 'a']);
    assert.deepStrictEqual(stored.map((n) => n.id), ['a', 'b', 'c']);
});

test('newestFirst orders by stamp, not by position in the array', () => {
    const shuffled = [at('b', '2026-01-01T10:00:01.000Z'), at('c', '2026-01-01T10:00:02.000Z'), at('a', '2026-01-01T10:00:00.000Z')];
    assert.deepStrictEqual(newestFirst(shuffled).map((n) => n.id), ['c', 'b', 'a']);
});

test('notes with equal stamps show the later arrival first', () => {
    const same = '2026-01-01T10:00:00.000Z';
    assert.deepStrictEqual(newestFirst([at('first', same), at('second', same), at('third', same)]).map((n) => n.id), ['third', 'second', 'first']);
});

test('notes without a stamp fall back to timecode, later timecode on top', () => {
    const tc = (seconds) => ({ hours: 0, minutes: 0, seconds, frames: 0, frameRate: 30 });
    const notes = [{ id: 'x', timecode: tc(5) }, { id: 'y', timecode: tc(30) }, { id: 'z', timecode: tc(10) }];
    assert.deepStrictEqual(newestFirst(notes).map((n) => n.id), ['y', 'z', 'x']);
});

test('newestFirst copes with an empty list', () => {
    assert.deepStrictEqual(newestFirst([]), []);
});
