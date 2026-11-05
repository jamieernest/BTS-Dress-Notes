const test = require('node:test');
const assert = require('node:assert');
const T = require('../public/playback-timeline');

test('a Vor file name gives the local time recording started', () => {
    assert.strictEqual(T.vorStartFromName('BUSMS Addams Family 26.2026-10-07 19-37-58.mov'),
        new Date(2026, 9, 7, 19, 37, 58).getTime());
    assert.strictEqual(T.vorTitleFromName('BUSMS Addams Family 26.2026-10-07 19-37-58.mov'), 'BUSMS Addams Family 26');
    assert.strictEqual(T.vorStartFromName('clip.mov'), null);
});

test('a note is placed when typing started: startedAt, else a realtime timecode', () => {
    const sent = new Date(2026, 9, 7, 19, 50, 0).getTime();
    const timestamp = new Date(sent).toISOString();
    assert.deepStrictEqual(T.noteTimes({ timestamp, startedAt: new Date(sent - 20000).toISOString() }), { sent, typed: sent - 20000 });
    assert.deepStrictEqual(T.noteTimes({ timestamp, timecode: { hours: 19, minutes: 49, seconds: 30, displayMode: 'realtime' } }),
        { sent, typed: sent - 30000 });
    assert.deepStrictEqual(T.noteTimes({ timestamp, timecode: { hours: 1, minutes: 2, seconds: 3, displayMode: 'midi' } }), { sent, typed: null });
});

test('scene changes come from the show log when there is one, else from the notes', () => {
    const at = (m) => new Date(2026, 9, 7, 19, m).toISOString();
    const notes = [
        { timestamp: at(45), act: 'Scene 2' }, { timestamp: at(40), act: 'Scene 1' }, { timestamp: at(42), act: 'Scene 1' }
    ];
    const fallback = T.changes({ notes }, 'scene');
    assert.strictEqual(fallback.exact, false);
    assert.deepStrictEqual(fallback.list.map(c => [c.value, c.at]), [['Scene 1', Date.parse(at(40))], ['Scene 2', Date.parse(at(45))]]);

    const showLog = [
        { type: 'scene', value: 'Scene 2', at: at(44) }, { type: 'cue', value: '1/5', at: at(41) }, { type: 'scene', value: 'Scene 1', at: at(38) }
    ];
    const exact = T.changes({ notes, showLog }, 'scene');
    assert.strictEqual(exact.exact, true);
    assert.deepStrictEqual(exact.list.map(c => c.value), ['Scene 1', 'Scene 2']);
    assert.strictEqual(T.valueAt(exact.list, Date.parse(at(43))).value, 'Scene 1');
    assert.strictEqual(T.valueAt(exact.list, Date.parse(at(30))), null);
});

test('a clock read off the video lands on the day of the recording, nearest am or pm', () => {
    const near = new Date(2026, 9, 7, 19, 40).getTime();
    assert.strictEqual(T.parseClock('7:47:58', near), new Date(2026, 9, 7, 19, 47, 58).getTime());
    assert.strictEqual(T.parseClock('19:47:58.5', near), new Date(2026, 9, 7, 19, 47, 58).getTime() + 500);
    assert.strictEqual(T.parseClock('25:00', near), null);
});
