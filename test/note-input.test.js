const test = require('node:test');
const assert = require('node:assert');
const input = require('../note-input');

test('note text must be a non-empty string and is cut to the maximum length', () => {
    assert.strictEqual(input.cleanText('  fix the gobo ', 100), '  fix the gobo ');
    for (const bad of [undefined, null, '', '   ', 42, {}, ['x']]) assert.strictEqual(input.cleanText(bad, 100), null);
    assert.strictEqual(input.cleanText('x'.repeat(150), 100).length, 100);
});

test('tags become a list of distinct short ids', () => {
    assert.deepStrictEqual(input.cleanTags(['lx', 'sound', 'lx', 7, null, {}, 'x'.repeat(500)]), ['lx', 'sound', '7']);
    assert.deepStrictEqual(input.cleanTags(undefined), []);
    assert.deepStrictEqual(input.cleanTags('lx'), []);
    assert.strictEqual(input.cleanTags(Array.from({ length: 80 }, (_, i) => `t${i}`)).length, 50);
});

test('a timecode keeps only known fields within range', () => {
    assert.deepStrictEqual(
        input.cleanTimecode({ hours: 1, minutes: 2, seconds: 3, frames: 4, frameRate: 25, source: 'midi', displayMode: 'midi', evil: '<b>' }),
        { hours: 1, minutes: 2, seconds: 3, frames: 4, frameRate: 25, source: 'midi', displayMode: 'midi' }
    );
    assert.deepStrictEqual(
        input.cleanTimecode({ hours: 21, minutes: 5, seconds: 9, milliseconds: 1234, frameRate: 'ms', displayMode: 'realtime' }),
        { hours: 21, minutes: 5, seconds: 9, frames: 0, milliseconds: 999, frameRate: 'ms', displayMode: 'realtime' }
    );
    assert.deepStrictEqual(input.cleanTimecode({ hours: -3, minutes: 99, seconds: '7', frames: 2.7 }), { hours: 0, minutes: 59, seconds: 7, frames: 2 });
    for (const bad of [undefined, null, 'x', [], { hours: 1 }, { hours: 'a', minutes: 1, seconds: 1 }]) {
        assert.strictEqual(input.cleanTimecode(bad), null);
    }
});

test('frame rates are numbers of frames per second or ms', () => {
    assert.strictEqual(input.cleanFrameRate(29.97), 29.97);
    assert.strictEqual(input.cleanFrameRate('ms'), 'ms');
    for (const bad of [0, -1, 1000, 'fast', null, undefined]) assert.strictEqual(input.cleanFrameRate(bad), null);
});

test('a tag needs a name; a colour that is not hex is dropped', () => {
    assert.deepStrictEqual(input.cleanTag({ id: 'lx', name: ' LX ', color: '#FF6B6B' }), { id: 'lx', name: 'LX', color: '#FF6B6B' });
    assert.deepStrictEqual(input.cleanTag({ name: 'Sound', color: 'red;background:url(x)' }), { id: null, name: 'Sound', color: null });
    for (const bad of [null, 'LX', {}, { name: '  ' }, { name: 5 }]) assert.strictEqual(input.cleanTag(bad), null);
});

test('cue labels and ids', () => {
    assert.strictEqual(input.cleanCue('1/1899 B/O'), '1/1899 B/O');
    assert.strictEqual(input.cleanCue(12), '12');
    assert.strictEqual(input.cleanCue(''), null);
    assert.strictEqual(input.cleanId('abc'), 'abc');
    assert.strictEqual(input.cleanId(''), null);
    assert.strictEqual(input.cleanId({}), null);
});
