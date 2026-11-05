const test = require('node:test');
const assert = require('node:assert');
const showLog = require('../show-log');

test('a cue keeps its name, not the fade time and percentage Eos adds while it runs', () => {
    assert.strictEqual(showLog.cueName('1/13 Build before Effect 3.9 3%'), '1/13 Build before Effect');
    assert.strictEqual(showLog.cueName('1/1899 B/O 3.0 100%'), '1/1899 B/O');
    assert.strictEqual(showLog.cueName('1/5 Preset'), '1/5 Preset');
});

test('an event repeating the last of its type is not recorded again', () => {
    const log = [];
    const at = new Date('2026-10-07T18:40:00Z');
    assert.strictEqual(showLog.record(log, 'cue', '1/13 Build 3.9 3%', at), true);
    assert.strictEqual(showLog.record(log, 'cue', '1/13 Build 2.1 47%', at), false);
    assert.strictEqual(showLog.record(log, 'scene', 'Act 1 Scene 2', at), true);
    // A scene in between doesn't make the same cue new.
    assert.strictEqual(showLog.record(log, 'cue', '1/13 Build 0.0 100%', at), false);
    assert.strictEqual(showLog.record(log, 'cue', '1/14 Swap', at), true);
    assert.strictEqual(showLog.record(log, 'scene', '   ', at), false);
    assert.strictEqual(showLog.record(log, 'flash', 'x', at), false);
    assert.deepStrictEqual(log.map(e => [e.type, e.value]), [
        ['cue', '1/13 Build'], ['scene', 'Act 1 Scene 2'], ['cue', '1/14 Swap']
    ]);
    assert.strictEqual(log[0].at, '2026-10-07T18:40:00.000Z');
});

test('a restored log keeps only valid events, in time order', () => {
    assert.deepStrictEqual(showLog.cleanShowLog(undefined), []);
    assert.deepStrictEqual(showLog.cleanShowLog([
        { type: 'scene', value: 'Two', at: '2026-10-07T18:50:00.000Z', extra: '<b>' },
        { type: 'scene', value: 'One', at: '2026-10-07T18:40:00.000Z' },
        { type: 'cue', value: 'x', at: 'not a date' },
        { type: 'other', value: 'x', at: '2026-10-07T18:40:00.000Z' },
        null
    ]), [
        { type: 'scene', value: 'One', at: '2026-10-07T18:40:00.000Z' },
        { type: 'scene', value: 'Two', at: '2026-10-07T18:50:00.000Z' }
    ]);
});
