// VIDEO_OFFSET_S: a finite number of seconds, bounded, never throwing, and how
// the Config & Status page words it.
const test = require('node:test');
const assert = require('node:assert');
const { parseVideoOffset, configFromEnv, MAX_OFFSET_S } = require('../video-offset');
const { describeOffset } = require('../public/obs-status');

test('unset or blank means no offset and no complaint', () => {
    for (const raw of [undefined, null, '', '   ']) assert.deepStrictEqual(parseVideoOffset(raw), { seconds: 0, error: null });
    assert.deepStrictEqual(configFromEnv({}), { seconds: 0, error: null });
});

test('plain numbers of seconds are accepted, to the millisecond', () => {
    assert.strictEqual(parseVideoOffset('3').seconds, 3);
    assert.strictEqual(parseVideoOffset(' +2.5 ').seconds, 2.5);
    assert.strictEqual(parseVideoOffset('-1.25').seconds, -1.25);
    assert.strictEqual(parseVideoOffset('.5').seconds, 0.5);
    assert.strictEqual(parseVideoOffset('0.0004').seconds, 0);
    assert.ok(Object.is(parseVideoOffset('-0.0001').seconds, 0));
    assert.strictEqual(parseVideoOffset(String(MAX_OFFSET_S)).seconds, MAX_OFFSET_S);
    assert.strictEqual(parseVideoOffset(`-${MAX_OFFSET_S}`).seconds, -MAX_OFFSET_S);
    assert.strictEqual(parseVideoOffset(configFromEnv({ VIDEO_OFFSET_S: '1.5' }).seconds).seconds, 1.5);
});

test('anything else is refused with a reason and no offset', () => {
    for (const raw of ['abc', '1s', '1,5', 'NaN', 'Infinity', '-Infinity', '0x10', '1e3', '--1', '1.2.3', `${MAX_OFFSET_S + 0.001}`, '-61', '1000000']) {
        const result = parseVideoOffset(raw);
        assert.strictEqual(result.seconds, 0, raw);
        assert.match(result.error, /VIDEO_OFFSET_S must be a number of seconds from -60 to 60/, raw);
    }
});

test('the Config page row: hidden without OBS, plain words, an error shown as bad', () => {
    assert.strictEqual(describeOffset(undefined).show, false);
    assert.strictEqual(describeOffset({ enabled: false, state: 'off', videoOffsetS: 2 }).show, false);
    assert.deepStrictEqual(describeOffset({ enabled: true, state: 'idle', videoOffsetS: 0 }), { show: true, tone: 'ok', text: 'None' });
    assert.deepStrictEqual(describeOffset({ enabled: true, state: 'idle' }), { show: true, tone: 'ok', text: 'None' });
    assert.match(describeOffset({ enabled: true, state: 'idle', videoOffsetS: 1.5 }).text, /^\+1\.5 s: new recordings start 1\.5 s earlier against the notes$/);
    assert.match(describeOffset({ enabled: true, state: 'idle', videoOffsetS: -2 }).text, /^-2 s: new recordings start 2 s later/);
    const bad = describeOffset({ enabled: true, state: 'idle', videoOffsetS: 0, videoOffsetError: 'VIDEO_OFFSET_S must be a number' });
    assert.deepStrictEqual([bad.show, bad.tone, bad.text], [true, 'bad', 'VIDEO_OFFSET_S must be a number']);
});
