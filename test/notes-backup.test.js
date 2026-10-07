const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { authorsOf, applyAuthors, backupFilename, backupTime, checkBackup, findRestorableBackup, writeBackupFile, MAX_AGE_MS } = require('../notes-backup');

const note = (id) => ({ id, text: 't', timestamp: '2026-10-07T18:00:00.000Z', tags: [], comments: [] });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-backup-'));
const NOW = Date.parse('2026-10-07T20:00:00.000Z');
const plant = (dir, agoMs, content) => {
    const name = backupFilename(new Date(NOW - agoMs));
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
    return name;
};

test('a backup file name round trips to the time it was made', () => {
    const date = new Date('2026-10-07T18:30:15.123Z');
    assert.strictEqual(backupTime(backupFilename(date)), date.getTime());
    assert.strictEqual(backupTime(`.${backupFilename(date)}.99.tmp`), null);
    assert.strictEqual(backupTime('notes.json'), null);
});

test('checkBackup accepts what the server writes and the older shape without totalNotes or tags', () => {
    assert.strictEqual(checkBackup({ notes: [note('a')], totalNotes: 1, tags: [{ id: 't', name: 'T' }] }), null);
    assert.strictEqual(checkBackup({ notes: [] }), null);
});

test('checkBackup rejects the wrong shape and a count that does not match', () => {
    for (const bad of [null, [], 'x', {}, { notes: {} }, { notes: [1] }, { notes: [{ text: 'no id', timestamp: 'x' }] },
        { notes: [{ id: 'a', text: 5, timestamp: '2026-10-07T18:00:00Z' }] },
        { notes: [{ id: 'a', text: 't', timestamp: 'never' }] },
        { notes: [{ ...note('a'), comments: 'x' }] },
        { notes: [{ ...note('a'), comments: [{ id: 'c' }] }] },
        { notes: [note('a'), note('a')] },
        { notes: [note('a')], totalNotes: 2 },
        { notes: [], tags: 'x' },
        { notes: [], tags: [{ id: 1 }] }]) {
        assert.ok(checkBackup(bad), `should reject ${JSON.stringify(bad)}`);
    }
});

test('findRestorableBackup picks the newest valid backup and reports the ones it skipped', () => {
    const dir = tmp();
    plant(dir, 50 * 60000, { notes: [note('old')] });
    const good = plant(dir, 20 * 60000, { notes: [note('good')], totalNotes: 1 });
    plant(dir, 10 * 60000, '{"notes":[');
    plant(dir, 5 * 60000, { notes: 'x' });
    const found = findRestorableBackup(dir, { now: NOW });
    assert.strictEqual(found.file, good);
    assert.strictEqual(found.data.notes[0].id, 'good');
    assert.strictEqual(found.skipped.length, 2);
});

test('findRestorableBackup ignores backups older than the limit, and never throws', () => {
    const dir = tmp();
    plant(dir, MAX_AGE_MS + 1000, { notes: [note('stale')] });
    const old = findRestorableBackup(dir, { now: NOW });
    assert.strictEqual(old.file, null);
    assert.match(old.reason, /older than 120 minutes/);
    plant(dir, MAX_AGE_MS - 1000, { notes: [note('fresh')] });
    assert.strictEqual(findRestorableBackup(dir, { now: NOW }).data.notes[0].id, 'fresh');
    assert.match(findRestorableBackup(path.join(dir, 'missing'), { now: NOW }).reason, /no backups folder/);
    assert.strictEqual(findRestorableBackup(tmp(), { now: NOW }).reason, 'no backup files');
    fs.writeFileSync(path.join(dir, `.${backupFilename()}.1.tmp`), '{');
    fs.mkdirSync(path.join(dir, backupFilename(new Date(NOW))));
    assert.strictEqual(findRestorableBackup(dir, { now: NOW }).data.notes[0].id, 'fresh'); // a directory named like a backup is skipped
});

test('writeBackupFile leaves only the finished file, in both modes', async () => {
    const dir = tmp();
    writeBackupFile(dir, 'backup-2026-10-07T18-00-00-000Z.json', '{"notes":[]}');
    await new Promise((resolve, reject) => writeBackupFile(dir, 'backup-2026-10-07T18-01-00-000Z.json', '{"notes":[1]}', (e) => (e ? reject(e) : resolve())));
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['backup-2026-10-07T18-00-00-000Z.json', 'backup-2026-10-07T18-01-00-000Z.json']);
    assert.throws(() => writeBackupFile(path.join(dir, 'missing'), 'x.json', ''));
});

test('authorsOf lists each Keycloak identity once with its latest name, and skips notes with no author', () => {
    const notes = [{ ...note('a'), userId: 'sub-1', user: 'Al' }, note('b'), { ...note('c'), userId: 'sub-1', user: 'Alice' }, { ...note('d'), userId: 'sub-2', user: 'Bob' }];
    assert.deepStrictEqual(authorsOf(notes), [{ userId: 'sub-1', name: 'Alice' }, { userId: 'sub-2', name: 'Bob' }]);
});

test('applyAuthors relabels by identity and never changes who owns a note', () => {
    const notes = [{ ...note('a'), userId: 'sub-1', user: 'Old name' }, note('b')];
    applyAuthors(notes, [{ userId: 'sub-1', name: 'New name' }]);
    assert.strictEqual(notes[0].user, 'New name');
    assert.strictEqual(notes[0].userId, 'sub-1');
    assert.strictEqual(notes[1].userId, undefined);
    assert.doesNotThrow(() => applyAuthors([note('c')]));
});

test('checkBackup accepts backups with or without author data and rejects malformed author data', () => {
    assert.strictEqual(checkBackup({ notes: [{ ...note('a'), userId: 's' }], authors: [{ userId: 's', name: 'S' }] }), null);
    assert.strictEqual(checkBackup({ notes: [note('a')] }), null);
    assert.ok(checkBackup({ notes: [{ ...note('a'), userId: 5 }] }));
    assert.ok(checkBackup({ notes: [], authors: 'x' }));
    assert.ok(checkBackup({ notes: [], authors: [{ name: 'no id' }] }));
});
