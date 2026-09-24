const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSettings, saveSettings } = require('../settings');

function tempFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-settings-'));
    return path.join(dir, 'local-settings.json');
}

test('a missing settings file loads as no settings', () => {
    assert.deepStrictEqual(loadSettings(tempFile()), {});
});

test('saved settings load back after a restart', () => {
    const file = tempFile();
    saveSettings(file, { midiInput: 'IAC Driver Bus 1', networkInterface: '10.10.160.50' });
    assert.deepStrictEqual(loadSettings(file), { midiInput: 'IAC Driver Bus 1', networkInterface: '10.10.160.50' });
    saveSettings(file, { midiInput: null, networkInterface: 'auto' });
    assert.deepStrictEqual(loadSettings(file), { midiInput: null, networkInterface: 'auto' });
    assert.strictEqual(fs.existsSync(`${file}.tmp`), false);
});

test('a corrupt settings file loads as no settings', () => {
    const file = tempFile();
    fs.writeFileSync(file, '{ not json');
    assert.deepStrictEqual(loadSettings(file), {});
    fs.writeFileSync(file, '[1, 2]');
    assert.deepStrictEqual(loadSettings(file), {});
});
