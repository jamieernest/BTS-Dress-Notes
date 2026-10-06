const test = require('node:test');
const assert = require('node:assert');
const { createChatRestore, sanitizeChatLog, boundChatMessage } = require('../chat-restore');

function log(n = 3, text = 'hi') {
    return Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        user: 'Alice',
        userId: 'sub-1',
        text: `${text} ${i}`,
        timestamp: new Date(Date.UTC(2026, 8, 24, 18, i)).toISOString()
    }));
}

test('two users offering the same log restore it', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(), []), null);
    assert.deepStrictEqual(r.offer('b', log(), []), log());
});

test('a single user offering, even from several tabs, restores nothing', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(), []), null);
    assert.strictEqual(r.offer('a', log(), []), null);
});

test('mismatched offers do not restore', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(3), []), null);
    assert.strictEqual(r.offer('b', log(2), []), null);
    assert.strictEqual(r.offer('c', log(3, 'other'), []), null);
    const reordered = log(3).reverse();
    assert.strictEqual(r.offer('d', reordered, []), null);
});

test('offers are ignored once chat is non-empty or closed', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(), []), null);
    assert.strictEqual(r.offer('b', log(), log(1)), null);
    assert.strictEqual(r.offer('c', log(), []), null);

    const sent = createChatRestore();
    sent.offer('a', log(), []);
    sent.close();
    assert.strictEqual(sent.offer('b', log(), []), null);
});

test('only the first restore happens', () => {
    const r = createChatRestore();
    r.offer('a', log(), []);
    assert.ok(r.offer('b', log(), []));
    assert.strictEqual(r.offer('c', log(), []), null);
});

test('malformed or oversized offers are rejected', () => {
    assert.strictEqual(sanitizeChatLog('nope'), null);
    assert.strictEqual(sanitizeChatLog([]), null);
    assert.strictEqual(sanitizeChatLog(log(101)), null);
    assert.strictEqual(sanitizeChatLog([null]), null);
    assert.strictEqual(sanitizeChatLog([{ ...log(1)[0], text: 'x'.repeat(100000) }]), null);
    assert.strictEqual(sanitizeChatLog([{ ...log(1)[0], timestamp: 'garbage' }]), null);
    assert.strictEqual(sanitizeChatLog([{ ...log(1)[0], id: 5 }]), null);
    assert.strictEqual(sanitizeChatLog(log(100)).length, 100);
    const extra = sanitizeChatLog([{ ...log(1)[0], evil: 'x' }]);
    assert.deepStrictEqual(Object.keys(extra[0]), ['id', 'user', 'userId', 'text', 'timestamp']);
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', 'junk', []), null);
    assert.strictEqual(r.offer('b', 'junk', []), null);
});

test('bounded live messages always pass the restore sanitizer', () => {
    const b = boundChatMessage({ user: 'u'.repeat(1000), userId: 's'.repeat(1000), text: 'x'.repeat(100000) });
    const out = sanitizeChatLog([{ id: 'a1', ...b, timestamp: new Date().toISOString() }]);
    assert.ok(out);
    assert.strictEqual(boundChatMessage({ user: 'u', userId: 's', text: { a: 1 } }), null);
});
