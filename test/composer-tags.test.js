const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createComposerTags } = require('../public/composer-tags');
function setup() {
    const values = new Map([['last-tags:alice', '["lx"]']]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    return { values, storage, a: createComposerTags(storage), b: createComposerTags(storage) };
}
test('migrates existing selections and persists every change including empty across reload and identities', () => {
    const { a, storage } = setup();
    assert.deepEqual(a.load('alice'), ['lx']);
    a.save('alice', ['sound']);
    assert.deepEqual(createComposerTags(storage).load('alice'), ['sound']);
    a.save('alice', []);
    assert.deepEqual(createComposerTags(storage).load('alice'), []);
    assert.deepEqual(a.load('bob'), []);
    a.save('bob', ['stage']);
    assert.deepEqual(a.load('alice'), []);
    a.save(null, ['lx']);
    assert.deepEqual(a.load(null), []);
});
test('other tabs read the most recent selection rather than stale page or draft state', () => {
    const { a, b } = setup();
    assert.deepEqual(a.load('alice'), ['lx']);
    b.save('alice', ['sound']);
    assert.deepEqual(a.load('alice'), ['sound']);
    b.save('alice', []);
    assert.deepEqual(a.load('alice'), []);
});
test('malformed storage is tolerated; blocked storage retains selections for this page', () => {
    const { a, values } = setup();
    values.set('last-tags:alice', '["lx",null,42]');
    assert.deepEqual(a.load('alice'), ['lx']);
    values.set('last-tags:bob', '{}');
    assert.deepEqual(a.load('bob'), []);
    const blocked = createComposerTags({ getItem() { throw Error(); }, setItem() { throw Error(); } });
    blocked.save('alice', ['sound']);
    assert.deepEqual(blocked.load('alice'), ['sound']);
    blocked.save('alice', []);
    assert.deepEqual(blocked.load('alice'), []);
});


test('reconcile drops removed sticky ids and keeps an explicit empty selection', () => {
    const values = new Map();
    const tags = createComposerTags({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
    tags.save('sub-person', ['crew', 'sound']);
    assert.deepEqual(tags.reconcile('sub-person', [{ id: 'sound' }]), ['sound']);
    assert.deepEqual(tags.load('sub-person'), ['sound']);
    assert.deepEqual(tags.reconcile('sub-person', []), []);
    assert.deepEqual(tags.load('sub-person'), []);
});
