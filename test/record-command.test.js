// OSC address routing for the recording cues: they are told apart from scene
// labels (which share the /bts/ prefix), and the optional secret is required
// only when one is set.
const test = require('node:test');
const assert = require('node:assert');
const { isRecordAddress, parseRecordCommand, carriesSecret } = require('../record-command');

test('only addresses under /bts/record belong to recording', () => {
    for (const address of ['/bts/record', '/bts/record/start', '/bts/record/stop', '/bts/record/other', '/bts/record/start/extra']) {
        assert.strictEqual(isRecordAddress(address), true, address);
    }
    // Scene labels, including ones that merely begin with the same letters.
    for (const address of ['/bts/scene', '/bts/', '/bts/recording', '/bts/records/start', '/bts', '/eos/out/active/cue/text', '', undefined, null, 5]) {
        assert.strictEqual(isRecordAddress(address), false, String(address));
    }
});

test('start and stop are commands; anything else under /bts/record is ignored', () => {
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', [], ''), { action: 'start' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/stop', [], ''), { action: 'stop' });
    // A value is not needed, and an unexpected one does no harm.
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', ['anything'], ''), { action: 'start' });
    for (const address of ['/bts/record', '/bts/record/', '/bts/record/pause', '/bts/record/START', '/bts/record/start/', '/bts/record/__proto__', '/bts/record/constructor']) {
        assert.deepStrictEqual(parseRecordCommand(address, [], ''), { ignored: 'unknown' }, address);
    }
});

test('with a secret set, the message must carry it as an argument', () => {
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', ['s3cret'], 's3cret'), { action: 'start' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/stop', ['x', 's3cret'], 's3cret'), { action: 'stop' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', [], 's3cret'), { ignored: 'secret' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', undefined, 's3cret'), { ignored: 'secret' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', ['wrong'], 's3cret'), { ignored: 'secret' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', ['s3cre'], 's3cret'), { ignored: 'secret' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', ['s3cret '], 's3cret'), { ignored: 'secret' });
    assert.deepStrictEqual(parseRecordCommand('/bts/record/start', [{}, null, true], 's3cret'), { ignored: 'secret' });
});

test('a numeric secret matches whether QLab sends a number or text', () => {
    assert.strictEqual(carriesSecret([1234], '1234'), true);
    assert.strictEqual(carriesSecret(['1234'], '1234'), true);
    assert.strictEqual(carriesSecret([1235], '1234'), false);
});

test('an unknown address is ignored whatever the secret says', () => {
    assert.deepStrictEqual(parseRecordCommand('/bts/record/nope', ['s3cret'], 's3cret'), { ignored: 'unknown' });
});
