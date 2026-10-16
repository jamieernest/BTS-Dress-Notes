// A recording in several parts laid out on one timeline, with gaps where it
// stopped (public/playback-program.js).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/playback-program.js');

const T0 = Date.parse('2026-10-07T19:30:00Z');
const part = (id, startSec, duration) => ({ id, startAt: startSec === null ? null : T0 + startSec * 1000, duration });

test('parts sit at the time they started, leaving gaps between them', () => {
    const program = P.layout([part('b', 700, 300), part('a', 0, 600)]);
    assert.strictEqual(program.origin, T0);
    assert.strictEqual(program.total, 1000);
    assert.deepStrictEqual(program.segments.map(s => [s.id, s.offset, s.end]), [['a', 0, 600], ['b', 700, 1000]]);
    assert.deepStrictEqual(P.gaps(program), [{ from: 600, to: 700 }]);
});

test('locate finds the part and the place inside it, or the next part after a gap', () => {
    const program = P.layout([part('a', 0, 600), part('b', 700, 300)]);
    assert.deepStrictEqual([P.locate(program, 650).segment, P.locate(program, 650).next.id], [null, 'b']);
    const inB = P.locate(program, 750);
    assert.deepStrictEqual([inB.segment.id, inB.local], ['b', 50]);
    assert.strictEqual(P.locate(program, 600).segment, null, 'a part ends where it ends');
    assert.deepStrictEqual(P.locate(program, 1000), { segment: null, next: null });
});

test('where parts overlap the earlier one plays and there is no gap', () => {
    const program = P.layout([part('a', 0, 600), part('b', 500, 300)]);
    assert.strictEqual(P.locate(program, 550).segment.id, 'a');
    assert.strictEqual(P.locate(program, 650).segment.id, 'b');
    assert.deepStrictEqual(P.gaps(program), []);
    assert.strictEqual(program.total, 800);
});

test('a part without a start time follows the one before it, or ends where the next starts', () => {
    const after = P.layout([part('a', 0, 600), part('b', null, 100)]);
    assert.deepStrictEqual(after.segments.map(s => [s.id, s.offset]), [['a', 0], ['b', 600]]);
    const before = P.layout([part('a', null, 100), part('b', 600, 100)]);
    assert.strictEqual(before.origin, T0 + 500 * 1000);
    assert.deepStrictEqual(before.segments.map(s => [s.id, s.offset]), [['a', 0], ['b', 100]]);
});

test('with no start times the parts play back to back without a clock', () => {
    const program = P.layout([part('a', null, 60), part('b', null, 40)]);
    assert.strictEqual(program.origin, null);
    assert.strictEqual(program.total, 100);
    assert.deepStrictEqual(program.segments.map(s => [s.id, s.offset, s.start]), [['a', 0, null], ['b', 60, null]]);
});

test('parts with no length are left out', () => {
    assert.deepStrictEqual(P.layout([part('a', 0, 0), { id: 'b', startAt: T0 }]), { origin: null, total: 0, segments: [] });
});
