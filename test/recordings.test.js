// Uploaded recordings on disk (recordings.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const recordings = require('../recordings');

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordings-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

const info = (name, startAt, duration = 60) => recordings.cleanPartInfo({ name, startAt, duration });

test('part details are checked', () => {
    assert.deepStrictEqual(info('Show.2026-10-07 19-30-00.mp4', Date.parse('2026-10-07T19:30:00Z')), {
        name: 'Show.2026-10-07 19-30-00.mp4', ext: 'mp4', type: 'video/mp4', startAt: '2026-10-07T19:30:00.000Z', duration: 60
    });
    assert.strictEqual(info('../../etc/passwd.mov', null).name, '.. .. etc passwd.mov');
    assert.ok(info('notes.json', null).error);
    assert.ok(info('', null).error);
    assert.ok(info('a.mp4', 'yesterday').error);
    assert.ok(info('a.mp4', null, 0).error);
    assert.strictEqual(info('a.MOV', '').startAt, null);
});

test('parts are added, listed in time order, retimed and removed', async (t) => {
    const dir = tempDir(t);
    const second = await recordings.addPart(dir, 'live', Readable.from([Buffer.from('two')]), info('b.mp4', Date.parse('2026-10-07T20:00:00Z')), { uploadedBy: 'Alice' });
    const first = await recordings.addPart(dir, 'live', Readable.from([Buffer.from('one!')]), info('a.mp4', Date.parse('2026-10-07T19:00:00Z')));
    assert.match(first.id, recordings.PART_ID);
    assert.deepStrictEqual(recordings.listParts(dir, 'live').map(p => [p.name, p.size]), [['a.mp4', 4], ['b.mp4', 3]]);
    assert.strictEqual(second.uploadedBy, 'Alice');
    assert.strictEqual(fs.readFileSync(recordings.partFile(dir, 'live', first.id).path, 'utf8'), 'one!');

    assert.strictEqual(recordings.setPartStart(dir, 'live', first.id, 'soon'), undefined);
    assert.strictEqual(recordings.setPartStart(dir, 'live', 'f'.repeat(32), Date.now()), null);
    recordings.setPartStart(dir, 'live', first.id, Date.parse('2026-10-07T21:00:00Z'));
    assert.deepStrictEqual(recordings.listParts(dir, 'live').map(p => p.name), ['b.mp4', 'a.mp4']);

    assert.strictEqual(recordings.removePart(dir, 'live', first.id), true);
    assert.strictEqual(recordings.removePart(dir, 'live', first.id), false);
    assert.strictEqual(recordings.partFile(dir, 'live', first.id), null);
    assert.strictEqual(recordings.partFile(dir, 'live', '../recordings.json'), null);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'live')).sort(), [`${second.id}.mp4`, 'recordings.json']);
});

test('an upload over the limit, or empty, keeps nothing', async (t) => {
    const dir = tempDir(t);
    await assert.rejects(recordings.addPart(dir, 'live', Readable.from([Buffer.alloc(10)]), info('a.mp4', null), { maxBytes: 5 }), { status: 413 });
    await assert.rejects(recordings.addPart(dir, 'live', Readable.from([]), info('a.mp4', null)), { status: 400 });
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'live')), []);
});

test('a saved show keeps its copy after the live parts are removed', async (t) => {
    const dir = tempDir(t);
    await recordings.addPart(dir, 'live', Readable.from([Buffer.from('video')]), info('a.mp4', null));
    assert.strictEqual(await recordings.copyCollection(dir, 'live', 'show-1'), 1);
    assert.strictEqual(await recordings.copyCollection(dir, 'empty', 'show-2'), 0);
    recordings.removeCollection(dir, 'live');
    const [kept] = recordings.listParts(dir, 'show-1');
    assert.strictEqual(fs.readFileSync(recordings.partFile(dir, 'show-1', kept.id).path, 'utf8'), 'video');
    assert.deepStrictEqual([...recordings.partCounts(dir)], [['show-1', 1]]);
});
