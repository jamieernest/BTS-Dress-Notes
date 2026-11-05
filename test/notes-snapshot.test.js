const test = require('node:test');
const assert = require('node:assert');
const { createNotesSnapshot, MAX_AGE_MS } = require('../public/notes-snapshot.js');

function memoryStorage() {
    const items = new Map();
    return {
        items,
        getItem: (k) => (items.has(k) ? items.get(k) : null),
        setItem: (k, v) => { items.set(k, String(v)); },
        removeItem: (k) => { items.delete(k); }
    };
}
const note = (id) => ({ id, text: `note ${id}`, timestamp: '2026-10-16T12:00:00.000Z', tags: ['dsm'], comments: [] });

test('a snapshot saved by one page load comes back on the next', () => {
    const storage = memoryStorage();
    createNotesSnapshot(storage).save({ sub: 'sub-alice', name: 'Alice', notes: [note('a'), note('b')] });
    const loaded = createNotesSnapshot(storage).load();
    assert.strictEqual(loaded.sub, 'sub-alice');
    assert.strictEqual(loaded.name, 'Alice');
    assert.deepStrictEqual(loaded.notes, [note('a'), note('b')]);
});

test('nothing is saved before the server has said who is logged in', () => {
    const storage = memoryStorage();
    createNotesSnapshot(storage).save({ sub: '', name: 'Guest', notes: [note('a')] });
    assert.strictEqual(storage.items.size, 0);
    assert.strictEqual(createNotesSnapshot(storage).load(), null);
});

test('an old, future-dated or malformed snapshot is ignored', () => {
    const storage = memoryStorage();
    const clock = { now: 1_000_000_000_000 };
    const snapshot = createNotesSnapshot(storage, () => clock.now);
    snapshot.save({ sub: 's', name: 'S', notes: [note('a')] });
    clock.now += MAX_AGE_MS + 1;
    assert.strictEqual(snapshot.load(), null);
    clock.now -= 2 * (MAX_AGE_MS + 1);
    assert.strictEqual(snapshot.load(), null, 'saved "in the future" (clock changed)');

    for (const bad of ['not json', 'null', '[]', '{"savedAt":1,"sub":"s","name":"S"}', JSON.stringify({ savedAt: clock.now, notes: [] })]) {
        storage.items.set('notes-snapshot', bad);
        assert.strictEqual(snapshot.load(), null, bad);
    }
});

test('notes missing what the page needs are left out', () => {
    const storage = memoryStorage();
    const snapshot = createNotesSnapshot(storage);
    snapshot.save({ sub: 's', name: 'S', notes: [note('a'), null, { id: 'b' }, 'x', { ...note('c'), id: 3 }] });
    assert.deepStrictEqual(snapshot.load().notes.map((n) => n.id), ['a']);
});

test('clear removes it, and a full or missing storage is not an error', () => {
    const storage = memoryStorage();
    const snapshot = createNotesSnapshot(storage);
    snapshot.save({ sub: 's', name: 'S', notes: [note('a')] });
    snapshot.clear();
    assert.strictEqual(snapshot.load(), null);

    storage.items.set('notes-snapshot', 'stale');
    const full = { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } };
    createNotesSnapshot(full).save({ sub: 's', name: 'S', notes: [note('a')] });
    assert.strictEqual(storage.items.has('notes-snapshot'), false, 'the stale one is dropped');

    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    assert.strictEqual(createNotesSnapshot(broken).load(), null);
    createNotesSnapshot(broken).save({ sub: 's', name: 'S', notes: [] });
    createNotesSnapshot(broken).clear();
});

test('the top bar comes back with the notes, and a damaged one is dropped without losing them', () => {
    const storage = memoryStorage();
    const tc = { hours: 1, minutes: 2, seconds: 3, frames: 4, frameRate: 25 };
    const live = {
        users: [{ id: 'sub-alice', name: 'Alice', isTyping: true }, { name: 'no id' }],
        act: 'Act 1', cue: '42', timeMode: 'midi', oscAvailable: true, unreadChat: 3,
        timecodes: { midi: tc, network: tc }, liveSources: { midi: true, network: 'yes' }
    };
    createNotesSnapshot(storage).save({ sub: 's', name: 'S', notes: [note('a')], live });
    assert.deepStrictEqual(createNotesSnapshot(storage).load().live, {
        users: [{ id: 'sub-alice', name: 'Alice' }],
        act: 'Act 1', cue: '42', timeMode: 'midi', oscAvailable: true, unreadChat: 3,
        timecodes: { midi: tc, network: tc }, liveSources: { midi: true, network: false }
    });

    createNotesSnapshot(storage).save({ sub: 's', name: 'S', notes: [note('a')], live: { ...live, timeMode: 'sundial' } });
    const loaded = createNotesSnapshot(storage).load();
    assert.strictEqual(loaded.live, null);
    assert.strictEqual(loaded.notes.length, 1);
});
