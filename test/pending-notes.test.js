const test = require('node:test');
const assert = require('node:assert');
const { createPendingNotes, MAX_AGE_MS } = require('../public/pending-notes.js');

function memoryStorage() {
    const items = new Map();
    return {
        items,
        getItem: (k) => (items.has(k) ? items.get(k) : null),
        setItem: (k, v) => { items.set(k, String(v)); },
        removeItem: (k) => { items.delete(k); }
    };
}
const entry = (clientId, writtenAt, text = 'note') => ({ note: { clientId, text, tags: [] }, writtenAt });

test('pending notes saved by one page load back on the next', () => {
    const storage = memoryStorage();
    const clock = { now: 1_000_000_000 };
    const pending = createPendingNotes(storage, () => clock.now);
    pending.add('sub-alice', entry('a', clock.now - 5));
    pending.add('sub-alice', entry('b', clock.now));
    const loaded = createPendingNotes(storage, () => clock.now).load('sub-alice');
    assert.deepStrictEqual(loaded.map((p) => p.note.clientId), ['a', 'b']);
});

test('two tabs of one person keep each other\'s pending notes', () => {
    const storage = memoryStorage();
    const tabA = createPendingNotes(storage), tabB = createPendingNotes(storage);
    tabA.add('sub-alice', entry('from-a', Date.now()));
    tabB.add('sub-alice', entry('from-b', Date.now()));
    assert.deepStrictEqual(tabA.load('sub-alice').map((p) => p.note.clientId), ['from-a', 'from-b']);
    tabB.remove('sub-alice', 'from-b');
    assert.deepStrictEqual(tabB.load('sub-alice').map((p) => p.note.clientId), ['from-a']);
});

test('each person only gets their own pending notes', () => {
    const storage = memoryStorage();
    const pending = createPendingNotes(storage);
    pending.add('sub-alice', entry('a', Date.now()));
    assert.deepStrictEqual(pending.load('sub-bob'), []);
    assert.deepStrictEqual(pending.load(undefined), []);
    pending.add(undefined, entry('x', Date.now()));
    assert.strictEqual(storage.items.size, 1);
});

test('removing the last or clearing removes the entry; old or malformed entries are dropped', () => {
    const storage = memoryStorage();
    const clock = { now: 1_000_000_000_000 };
    const pending = createPendingNotes(storage, () => clock.now);
    storage.setItem('pending-notes:s', JSON.stringify([entry('old', clock.now - MAX_AGE_MS - 1), entry('ok', clock.now), { note: { text: 'no id' }, writtenAt: clock.now }, null]));
    assert.deepStrictEqual(pending.load('s').map((p) => p.note.clientId), ['ok']);
    pending.remove('s', 'ok');
    assert.strictEqual(storage.items.size, 0);
    pending.add('s', entry('a', clock.now));
    pending.clear('s');
    assert.strictEqual(storage.items.size, 0);
    storage.setItem('pending-notes:s', '{not json');
    assert.deepStrictEqual(pending.load('s'), []);
});

test('storage that throws only loses the copy', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
    const pending = createPendingNotes(broken);
    assert.doesNotThrow(() => pending.add('s', entry('a', Date.now())));
    assert.doesNotThrow(() => pending.remove('s', 'a'));
    assert.deepStrictEqual(pending.load('s'), []);
});
