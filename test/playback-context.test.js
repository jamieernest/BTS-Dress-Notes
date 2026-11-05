const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/playback-context');

test('local file keys work on HTTP pages where randomUUID is unavailable', (t) => {
    t.mock.method(globalThis.crypto, 'randomUUID', () => { throw new Error('HTTPS only'); });
    assert.match(C.newFileKey(), /^[0-9a-f]{32}$/);
});

test('playback links carry the show and selected note without confusing URL delimiters', () => {
    const url = new URL(C.playbackUrl({ show: 'dress-1' }, 'note & "2"', '/recall.html?show=dress-1&tag=lx&q=door'), 'http://notes.local');
    assert.equal(url.searchParams.get('show'), 'dress-1');
    assert.equal(url.searchParams.get('note'), 'note & "2"');
    assert.equal(url.searchParams.get('returnTo'), '/recall.html?show=dress-1&tag=lx&q=door');
    assert.equal(C.playbackUrl({ source: 'live' }), '/playback.html?source=live');
});

test('returning to notes preserves filters and highlights the note; unsafe destinations fall back', () => {
    assert.equal(C.notesUrl({ show: 'dress' }, 'n 1', '/recall.html?show=dress&tag=lx'), '/recall.html?show=dress&tag=lx#note=n+1');
    assert.equal(C.notesUrl({ source: 'live' }, 'n1', 'https://elsewhere.test/'), '/#note=n1');
    for (const value of ['javascript:alert(1)', '//elsewhere.test/recall.html', '/logout', '/config.html', '/playback.html']) {
        assert.equal(C.safeReturnTo(value), '/');
    }
    assert.equal(C.notesUrl({ file: 'local-1' }), '/recall.html?file=local-1');
});

test('local notes survive a view change in this tab; missing, damaged and full storage are handled', () => {
    const items = new Map();
    const storage = { setItem: (key, value) => items.set(key, value), getItem: key => items.get(key) ?? null };
    const notes = { notes: [{ id: 'n', text: 'a note' }], showLog: [{ type: 'cue', value: '1/2' }] };
    assert.equal(C.saveFile(notes, 'Dress.json', storage, 'file-1'), 'file-1');
    assert.deepEqual(C.readFile('file-1', storage), { ...notes, name: 'Dress.json' });
    assert.equal(C.readFile('missing', storage), null);
    items.set('playback-file:bad', '{');
    assert.equal(C.readFile('bad', storage), null);
    assert.equal(C.saveFile(notes, 'Dress.json', { setItem() { throw new Error('Quota exceeded'); } }, 'file-2'), null);
});
