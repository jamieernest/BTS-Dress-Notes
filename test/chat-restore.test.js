const test = require('node:test');
const assert = require('node:assert');
const {
    createChatRestore, sanitizeChatLog, boundChatMessage, mergeChatLogs, agrees, messageKey, MAX_OFFER_MESSAGES
} = require('../chat-restore');

function log(n = 3, text = 'hi', from = 0) {
    return Array.from({ length: n }, (_, k) => {
        const i = from + k;
        return {
            id: `m${i}`,
            user: 'Alice',
            userId: 'sub-1',
            text: `${text} ${i}`,
            timestamp: new Date(Date.UTC(2026, 8, 24, 18, 0, i)).toISOString()
        };
    });
}

const keys = (l) => new Set(l.map(messageKey));
const ids = (l) => l.map((m) => m.id);

test('two users offering the same log restore it', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(), []), null);
    assert.deepStrictEqual(r.offer('b', log(), []), log());
});

test('a single user offering, even from several tabs, restores nothing', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(), []), null);
    assert.strictEqual(r.offer('a', log(), []), null);
    assert.strictEqual(r.offer('a', log(5), []), null);
});

test('agreement is containment on id and exact content', () => {
    assert.ok(agrees(keys(log(2)), keys(log(5))));
    assert.ok(agrees(keys(log(5)), keys(log(5))));
    assert.ok(!agrees(keys(log(5)), keys(log(2))));
    // reordering does not matter, a message missing from the longer log does
    assert.ok(agrees(keys(log(3).reverse()), keys(log(5))));
    assert.ok(!agrees(keys(log(2, 'hi', 10)), keys(log(5))));
    // same id, any field different: a different message, not a duplicate
    for (const field of ['user', 'userId', 'text', 'timestamp']) {
        const other = log(3);
        other[1] = { ...other[1], [field]: field === 'timestamp' ? '2027-01-01T00:00:00.000Z' : 'changed' };
        assert.ok(!agrees(keys(other), keys(log(5))), field);
    }
});

test('a shorter log agrees with a longer one that contains it, so copies differing by messages pair', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(3), []), null);
    assert.deepStrictEqual(ids(r.offer('b', log(5), [])), ['m0', 'm1', 'm2', 'm3', 'm4']);
});

test('the fullest log two users vouch for is restored', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(8), []), null);
    assert.strictEqual(r.offer('b', log(2, 'hi', 20), []), null); // not contained in a's log
    assert.deepStrictEqual(ids(r.offer('c', log(4), [])), ids(log(8)));
});

test('a log nobody else agrees with is not restored, however long', () => {
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', log(3, 'hi'), []), null);
    assert.strictEqual(r.offer('b', log(3, 'other'), []), null);
    assert.strictEqual(r.offer('c', log(50, 'solo', 100), []), null);
});

test('conflicting logs of equal size: the first offered wins', () => {
    const r = createChatRestore();
    const base = log(2);
    const left = [...base, ...log(1, 'left', 5)];
    const right = [...base, ...log(1, 'right', 6)];
    assert.strictEqual(r.offer('a', left, []), null);
    assert.strictEqual(r.offer('b', right, []), null);
    assert.deepStrictEqual(r.offer('c', base, []), left);
});

test('a later, larger agreed log replaces a smaller restored one', () => {
    const r = createChatRestore();
    r.offer('a', log(3), []);
    const restored = r.offer('b', log(3), []);
    assert.deepStrictEqual(ids(restored), ['m0', 'm1', 'm2']);
    // the server now holds the 3 restored messages; c holds more and the others' logs are inside it
    const bigger = r.offer('c', log(7), restored);
    assert.deepStrictEqual(ids(bigger), ids(log(7)));
    // nothing new to restore: a repeat offer changes nothing
    assert.strictEqual(r.offer('c', log(7), bigger), null);
    assert.strictEqual(r.offer('d', log(5), bigger), null);
});

test('a restore is skipped when the server already holds everything in it', () => {
    const r = createChatRestore();
    r.offer('a', log(3), []);
    assert.strictEqual(r.offer('b', log(3), log(3)), null);
});

test('messages already on the server do not stop a restore', () => {
    const r = createChatRestore();
    const fresh = log(1, 'new', 50);
    assert.strictEqual(r.offer('a', log(3), fresh), null);
    const restored = r.offer('b', log(3), fresh);
    assert.deepStrictEqual(ids(restored), ['m0', 'm1', 'm2']);
});

test('merging puts the restored history in order and drops duplicates by id', () => {
    const fresh = log(2, 'new', 10);
    const merged = mergeChatLogs(fresh, log(4));
    assert.deepStrictEqual(ids(merged), ['m0', 'm1', 'm2', 'm3', 'm10', 'm11']);
    // duplicates: the server's copy of a message wins
    const dup = [{ ...log(1)[0], text: 'server version' }];
    assert.deepStrictEqual(mergeChatLogs(dup, log(2)).map((m) => m.text), ['server version', 'hi 1']);
    assert.deepStrictEqual(ids(mergeChatLogs(log(3), log(3))), ['m0', 'm1', 'm2']);
    // equal timestamps keep their order
    const same = (id) => ({ id, user: 'u', userId: 'x', text: id, timestamp: '2026-09-24T18:00:00.000Z' });
    assert.deepStrictEqual(ids(mergeChatLogs([same('a'), same('b')], [same('c')])), ['a', 'b', 'c']);
});

test('the window closes by itself, so restoring cannot stay open forever', async () => {
    let closes = 0;
    const r = createChatRestore({ windowMs: 40, onClose: () => { closes++; } });
    r.offer('a', log(), []);
    assert.strictEqual(r.closed, false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.strictEqual(r.closed, true);
    assert.strictEqual(closes, 1);
    assert.strictEqual(r.offer('b', log(), []), null); // the pair is never completed
    r.close();
    assert.strictEqual(closes, 1);
});

test('malformed or absurd offers are rejected', () => {
    assert.strictEqual(sanitizeChatLog('nope'), null);
    assert.strictEqual(sanitizeChatLog([]), null);
    assert.strictEqual(sanitizeChatLog([null]), null);
    assert.strictEqual(sanitizeChatLog([{ ...log(1)[0], text: 'x'.repeat(100000) }]), null);
    assert.strictEqual(sanitizeChatLog([{ ...log(1)[0], timestamp: 'garbage' }]), null);
    assert.strictEqual(sanitizeChatLog([{ ...log(1)[0], id: 5 }]), null);
    assert.strictEqual(sanitizeChatLog(new Array(MAX_OFFER_MESSAGES + 1).fill(log(1)[0])), null);
    const extra = sanitizeChatLog([{ ...log(1)[0], evil: 'x' }]);
    assert.deepStrictEqual(Object.keys(extra[0]), ['id', 'user', 'userId', 'text', 'timestamp']);
    const r = createChatRestore();
    assert.strictEqual(r.offer('a', 'junk', []), null);
    assert.strictEqual(r.offer('b', 'junk', []), null);
});

test('a long chat is a valid offer: there is no 100 message limit', () => {
    assert.strictEqual(sanitizeChatLog(log(5000)).length, 5000);
    const r = createChatRestore();
    r.offer('a', log(2500), []);
    assert.strictEqual(r.offer('b', log(2500), []).length, 2500);
});

test('bounded live messages always pass the restore sanitizer', () => {
    const b = boundChatMessage({ user: 'u'.repeat(1000), userId: 's'.repeat(1000), text: 'x'.repeat(100000) });
    const out = sanitizeChatLog([{ id: 'a1', ...b, timestamp: new Date().toISOString() }]);
    assert.ok(out);
    assert.strictEqual(boundChatMessage({ user: 'u', userId: 's', text: { a: 1 } }), null);
});
