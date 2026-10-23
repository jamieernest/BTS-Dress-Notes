const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanShowName, showId, saveShow, readShow, listShows } = require('../saved-shows');

const note = (id) => ({ id, text: 'x', timestamp: new Date().toISOString(), tags: [], comments: [] });
const exportOf = (notes) => ({ notes, totalNotes: notes.length, tags: [], authors: [] });

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-shows-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('a show name is tidied, and one with nothing in it is refused', () => {
    assert.strictEqual(cleanShowName('  BUSMS   Overture\nDress  '), 'BUSMS Overture Dress');
    assert.strictEqual(cleanShowName('   '), null);
    assert.strictEqual(cleanShowName(42), null);
    assert.strictEqual(cleanShowName('a'.repeat(300)).length, 100);
});

test('the id is the save time and a readable slug, and never a path', () => {
    const date = new Date('2026-10-16T21:05:00.123Z');
    assert.strictEqual(showId('BUSMS Overture Dress Notes 2026', date), '2026-10-16T21-05-00-123Z-busms-overture-dress-notes-2026');
    assert.strictEqual(showId('../../etc', date), '2026-10-16T21-05-00-123Z-etc');
    assert.strictEqual(showId('Café ✨', date), '2026-10-16T21-05-00-123Z-cafe');
    assert.strictEqual(showId('✨', date), '2026-10-16T21-05-00-123Z');
});

test('shows are listed newest first, read back whole, and bad ids or damaged files are left out', async (t) => {
    const dir = tempDir(t);
    const first = saveShow(dir, 'Tech', exportOf([note('a')]), new Date('2026-10-01T19:00:00Z'));
    const second = saveShow(dir, 'Dress', exportOf([note('b'), note('c')]), new Date('2026-10-02T19:00:00Z'));
    fs.writeFileSync(path.join(dir, '2026-10-03T19-00-00-000Z-broken.json'), '{"notes": [');
    fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ name: 'not a show id', ...exportOf([]) }));

    assert.deepStrictEqual(await listShows(dir), [
        { id: second.id, name: 'Dress', savedAt: '2026-10-02T19:00:00.000Z', totalNotes: 2 },
        { id: first.id, name: 'Tech', savedAt: '2026-10-01T19:00:00.000Z', totalNotes: 1 }
    ]);
    const data = await readShow(dir, first.id);
    assert.strictEqual(data.name, 'Tech');
    assert.deepStrictEqual(data.notes.map(n => n.id), ['a']);
    assert.strictEqual(await readShow(dir, '../notes-backup'), null);
    assert.strictEqual(await readShow(dir, 'notes'), null);
    assert.strictEqual(await readShow(dir, '2026-10-03T19-00-00-000Z-broken'), null);
    assert.deepStrictEqual(await listShows(path.join(dir, 'missing')), []);
});
