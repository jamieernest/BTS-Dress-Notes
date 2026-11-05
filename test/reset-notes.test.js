const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { KEEP_MS, isResetId, keepReset, readReset, listResets, prune } = require('../reset-notes');

const note = (id) => ({ id, text: 'x', timestamp: new Date().toISOString(), tags: [], comments: [] });
const exportOf = (notes) => ({ notes, totalNotes: notes.length, tags: [], authors: [] });

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-notes-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('the notes from a reset are kept for 3 days, then listed and read no more', async (t) => {
    const dir = tempDir(t);
    const at = new Date('2026-10-20T22:00:00.000Z');
    const id = keepReset(dir, exportOf([note('a'), note('b')]), 'Finn', at);
    assert.strictEqual(id, '2026-10-20T22-00-00-000Z');
    assert.strictEqual(KEEP_MS, 3 * 24 * 60 * 60 * 1000);

    const before = at.getTime() + KEEP_MS - 1;
    assert.deepStrictEqual(await listResets(dir, before), [{
        id, resetAt: at.toISOString(), resetBy: 'Finn', expiresAt: '2026-10-23T22:00:00.000Z', totalNotes: 2
    }]);
    assert.deepStrictEqual((await readReset(dir, id, before)).notes.map(n => n.id), ['a', 'b']);

    const after = at.getTime() + KEEP_MS;
    assert.deepStrictEqual(await listResets(dir, after), []);
    assert.strictEqual(await readReset(dir, id, after), null);
});

test('prune deletes only the kept resets whose time has run out', async (t) => {
    const dir = tempDir(t);
    const old = keepReset(dir, exportOf([note('a')]), 'A', new Date('2026-10-01T10:00:00Z'));
    const recent = keepReset(dir, exportOf([note('b')]), 'B', new Date('2026-10-03T10:00:00Z'));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not ours');
    assert.deepStrictEqual(await prune(dir, Date.parse('2026-10-05T10:00:00Z')), [old]);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [`${recent}.json`, 'notes.txt']);
});

test('two resets in the same millisecond are both kept, newest listed first', async (t) => {
    const dir = tempDir(t);
    const at = new Date('2026-10-20T22:00:00.000Z');
    const first = keepReset(dir, exportOf([note('a')]), 'A', at);
    const second = keepReset(dir, exportOf([note('b')]), 'B', at);
    assert.notStrictEqual(first, second);
    assert.deepStrictEqual((await listResets(dir, at.getTime())).map(r => r.id), [second, first]);
});

test('an id is only ever a reset time, never a path, and a damaged file is left out', async (t) => {
    const dir = tempDir(t);
    assert.strictEqual(isResetId('../backups/x'), false);
    assert.strictEqual(await readReset(dir, '../../etc/passwd'), null);
    fs.writeFileSync(path.join(dir, '2026-10-20T22-00-00-000Z.json'), '{"notes": [');
    assert.deepStrictEqual(await listResets(dir, Date.parse('2026-10-20T23:00:00Z')), []);
});
