// How the OBS state is worded on the notes page and the Config & Status page.
const test = require('node:test');
const assert = require('node:assert');
const { describe } = require('../public/obs-status');

test('nothing is shown when OBS is not set up', () => {
    assert.strictEqual(describe(undefined).show, false);
    assert.strictEqual(describe({ enabled: false, state: 'off' }).show, false);
});

test('idle, recording and error each read differently', () => {
    const idle = describe({ enabled: true, state: 'idle' });
    assert.deepStrictEqual([idle.show, idle.tone, idle.text], [true, 'ok', 'Not recording']);
    const rec = describe({ enabled: true, state: 'recording' });
    assert.deepStrictEqual([rec.tone, rec.label, rec.text], ['live', 'REC', 'Recording']);
    const error = describe({ enabled: true, state: 'error', error: 'OBS rejected the password' });
    assert.deepStrictEqual([error.tone, error.text], ['bad', 'OBS rejected the password']);
    assert.strictEqual(describe({ enabled: true, state: 'error' }).text, 'OBS is not reachable');
});

test('transitional and paused states are still recording-ish or neutral', () => {
    assert.strictEqual(describe({ enabled: true, state: 'paused' }).tone, 'live');
    assert.strictEqual(describe({ enabled: true, state: 'starting' }).tone, 'live');
    assert.strictEqual(describe({ enabled: true, state: 'connecting' }).tone, '');
    assert.strictEqual(describe({ enabled: true, state: 'stopping' }).tone, '');
});
