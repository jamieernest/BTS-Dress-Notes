// How the camera's last recall is worded on the Config & Status page.
const test = require('node:test');
const assert = require('node:assert');
const { describe } = require('../public/camera-status');

test('not configured, no recall yet, ok and failed each read differently', () => {
    assert.deepStrictEqual(describe(undefined), { tone: '', text: 'Not configured' });
    assert.deepStrictEqual(describe({ configured: false, state: 'off' }), { tone: '', text: 'Not configured' });
    assert.deepStrictEqual(describe({ configured: true, state: 'idle' }), { tone: '', text: 'No recall yet' });
    assert.deepStrictEqual(describe({ configured: true, state: 'ok', preset: 9, at: 'x' }, () => '19:30'), { tone: 'ok', text: 'Preset 9 recalled at 19:30' });
    assert.deepStrictEqual(describe({ configured: true, state: 'failed', preset: 9, error: 'the camera is not reachable' }),
        { tone: 'bad', text: 'Preset 9 failed: the camera is not reachable' });
});
