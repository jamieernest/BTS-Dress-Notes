// Recordings OBS saves in the videos folder: how long a file runs, adding it
// to the live notes without copying, never touching anything outside the
// folder, adding a file only once, and saying why a file cannot be played.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPickup, defaultVideosDir } = require('../obs-pickup');
const { readMp4Info } = require('../mp4-info');
const recordings = require('../recordings');
const { makeMp4 } = require('./video-fixtures');

const NOW = Date.parse('2026-11-22T20:00:00Z');

function setup(t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-pickup-'));
    const videos = path.join(root, 'Movies');
    const recordingsDir = path.join(root, 'recordings');
    const elsewhere = path.join(root, 'elsewhere');
    for (const dir of [videos, elsewhere]) fs.mkdirSync(dir);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const pickup = createPickup({ videosDir: videos, recordingsDir, now: () => NOW, ...options });
    // A finished recording that was last written `agoS` seconds before NOW.
    const write = (dir, name, buffer, agoS = 120) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, buffer);
        const when = new Date(NOW - agoS * 1000);
        fs.utimesSync(file, when, when);
        return file;
    };
    return { root, videos, recordingsDir, elsewhere, pickup, write };
}

test('the default videos folder is Movies on macOS and Videos elsewhere', () => {
    assert.strictEqual(defaultVideosDir('darwin', '/Users/x'), path.join('/Users/x', 'Movies'));
    assert.strictEqual(defaultVideosDir('win32', 'C:\\Users\\x'), path.join('C:\\Users\\x', 'Videos'));
    assert.strictEqual(defaultVideosDir('linux', '/home/x'), path.join('/home/x', 'Videos'));
});

test('readMp4Info reads the length of finished files, and says when it cannot', (t) => {
    const { videos, write } = setup(t);
    assert.strictEqual(readMp4Info(write(videos, 'a.mp4', makeMp4({ durationS: 12.5 }))).durationS, 12.5);
    assert.strictEqual(readMp4Info(write(videos, 'b.mp4', makeMp4({ durationS: 3600, timescale: 90000, version: 1 }))).durationS, 3600);
    assert.strictEqual(readMp4Info(write(videos, 'c.mp4', makeMp4({ durationS: 7, moovFirst: true }))).durationS, 7);
    assert.deepStrictEqual(readMp4Info(write(videos, 'd.mp4', makeMp4({ unfinished: true }))), { unfinished: true });
    assert.deepStrictEqual(readMp4Info(write(videos, 'e.mp4', makeMp4({ fragmented: true }))), { noDuration: true });
    assert.deepStrictEqual(readMp4Info(write(videos, 'f.mp4', Buffer.from('not a video at all'))), { unreadable: true });
    assert.deepStrictEqual(readMp4Info(write(videos, 'g.mp4', Buffer.alloc(0))), { unreadable: true });
    assert.deepStrictEqual(readMp4Info(path.join(videos, 'missing.mp4')), { unreadable: true });
});

test('a recording OBS finished is added without copying it, once', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t);
    const file = write(videos, '2026-11-22 19-30-00.mp4', makeMp4({ durationS: 600 }), 60);
    const outcome = pickup.importFile(file);
    assert.strictEqual(outcome.result, 'added');
    const [part] = recordings.listParts(recordingsDir, 'live');
    assert.strictEqual(part.id, outcome.part.id);
    assert.strictEqual(part.name, '2026-11-22 19-30-00.mp4');
    assert.strictEqual(part.duration, 600);
    assert.strictEqual(part.uploadedBy, 'OBS');
    // The recording began `duration` before the file was last written.
    assert.strictEqual(Date.parse(part.startAt), NOW - 60000 - 600000);
    // A hard link: the same file on disk, so nothing was copied.
    const linked = fs.statSync(path.join(recordingsDir, 'live', part.file));
    assert.strictEqual(linked.ino, fs.statSync(file).ino);
    assert.strictEqual(recordings.partFile(recordingsDir, 'live', part.id).path, path.join(recordingsDir, 'live', part.file));

    assert.strictEqual(pickup.importFile(file).result, 'duplicate');
    assert.strictEqual(recordings.listParts(recordingsDir, 'live').length, 1);

    // Removing the part from the notes leaves OBS's file alone, and it is not brought back.
    assert.strictEqual(recordings.removePart(recordingsDir, 'live', part.id), true);
    assert.ok(fs.existsSync(file));
    assert.strictEqual(pickup.importFile(file).result, 'duplicate');
    assert.strictEqual(pickup.scan({ since: 0 }).length, 0);
    assert.strictEqual(recordings.listParts(recordingsDir, 'live').length, 0);
});

test('the start time is when OBS says the recording began, when it says', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t);
    const began = NOW - 3600000;
    pickup.importFile(write(videos, '2026-11-22 19-00-00.mp4', makeMp4({ durationS: 100 })), { startedAt: began });
    assert.strictEqual(Date.parse(recordings.listParts(recordingsDir, 'live')[0].startAt), began);
});

test('a video offset moves the start earlier (positive) or later (negative) and 0 changes nothing', (t) => {
    const began = NOW - 3600000;
    const startOf = (offsetS) => {
        const { videos, recordingsDir, pickup, write } = setup(t, { offsetS });
        assert.strictEqual(pickup.importFile(write(videos, '2026-11-22 19-00-00.mp4', makeMp4({ durationS: 100 })), { startedAt: began }).result, 'added');
        return Date.parse(recordings.listParts(recordingsDir, 'live')[0].startAt);
    };
    assert.strictEqual(startOf(0), began);
    assert.strictEqual(startOf(undefined), began);
    assert.strictEqual(startOf(2.5), began - 2500);
    assert.strictEqual(startOf(-1.25), began + 1250);
});

test('the offset also applies to a recording the folder scan finds', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t, { offsetS: 3 });
    pickup.importFile(write(videos, '2026-11-22 19-00-00.mp4', makeMp4({ durationS: 100 }), 120));
    // Without a start from OBS: the file's last write less its length, then the offset.
    assert.strictEqual(Date.parse(recordings.listParts(recordingsDir, 'live')[0].startAt), NOW - 120000 - 100000 - 3000);
});

test('the offset only applies to recordings added after it, not to ones already stored', (t) => {
    const { videos, recordingsDir, write } = setup(t);
    const began = NOW - 3600000;
    const first = createPickup({ videosDir: videos, recordingsDir, now: () => NOW, offsetS: 0 });
    first.importFile(write(videos, '2026-11-22 18-00-00.mp4', makeMp4({ durationS: 10 })), { startedAt: began });
    const second = createPickup({ videosDir: videos, recordingsDir, now: () => NOW, offsetS: 5 });
    second.importFile(write(videos, '2026-11-22 19-00-00.mp4', makeMp4({ durationS: 10 })), { startedAt: began });
    const starts = recordings.listParts(recordingsDir, 'live').map((p) => Date.parse(p.startAt)).sort();
    assert.deepStrictEqual(starts, [began - 5000, began]);
});

test('the log says how the recorded start compares with the file and the offset', (t) => {
    const logs = [];
    const { videos, pickup, write } = setup(t, { offsetS: 1.5, log: (line) => logs.push(line) });
    // Ran 97 s by the clock but the file holds 100 s: the start was found 3 s late.
    pickup.importFile(write(videos, '2026-11-22 19-00-00.mp4', makeMp4({ durationS: 100 })), {
        startedAt: NOW - 97000, stoppingAt: NOW, stoppedAt: NOW + 800, startSource: 'event'
    });
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0], /start found from event/);
    assert.match(logs[0], /recorded for 97\.00 s by the clock, the file is 100\.00 s: start is 3\.00 s later/);
    assert.match(logs[0], /video offset \+1\.5 s applied/);
});

test('a paused or fragmented recording is not compared with the clock', (t) => {
    const logs = [];
    const { videos, pickup, write } = setup(t, { log: (line) => logs.push(line) });
    pickup.importFile(write(videos, '2026-11-22 19-00-00.mp4', makeMp4({ durationS: 50 })), { startedAt: NOW - 97000, stoppingAt: NOW, paused: true });
    pickup.importFile(write(videos, '2026-11-22 19-10-00.mp4', makeMp4({ fragmented: true }), 60), { startedAt: NOW - 600000, stoppingAt: NOW - 60000 });
    assert.match(logs[0], /was paused/);
    assert.match(logs[1], /fragmented MP4/);
    assert.ok(!logs.some((l) => /video offset/.test(l)));
});

test('a fragmented MP4 takes its length from when OBS began and the file was last written', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t);
    const file = write(videos, '2026-11-22 19-00-00.mp4', makeMp4({ fragmented: true }), 60);
    assert.strictEqual(pickup.importFile(file, { startedAt: NOW - 60000 - 1800000 }).result, 'added');
    assert.strictEqual(recordings.listParts(recordingsDir, 'live')[0].duration, 1800);
});

test('a file OBS is still writing waits, and is added once it is finished', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t);
    const name = '2026-11-22 19-30-00.mp4';
    const file = write(videos, name, makeMp4({ unfinished: true }), 5);
    assert.strictEqual(pickup.importFile(file).result, 'unfinished');
    assert.strictEqual(recordings.listParts(recordingsDir, 'live').length, 0);
    write(videos, name, makeMp4({ durationS: 30 }), 5);
    assert.strictEqual(pickup.importFile(file).result, 'added');
});

test('importFinished tries again while the file is finished', async (t) => {
    const { videos, pickup, write } = setup(t);
    const name = '2026-11-22 19-30-00.mp4';
    const file = write(videos, name, makeMp4({ unfinished: true }), 5);
    setTimeout(() => write(videos, name, makeMp4({ durationS: 30 }), 5), 30);
    const outcome = await pickup.importFinished(file, {}, { tries: 10, delayMs: 20 });
    assert.strictEqual(outcome.result, 'added');
    const never = write(videos, '2026-11-22 19-40-00.mp4', makeMp4({ unfinished: true }), 5);
    assert.strictEqual((await pickup.importFinished(never, {}, { tries: 2, delayMs: 5 })).result, 'unfinished');
});

test('a container browsers cannot play says so, once, and is not added', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t);
    const file = write(videos, '2026-11-22 19-30-00.mkv', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]));
    const outcome = pickup.importFile(file);
    assert.strictEqual(outcome.result, 'unplayable');
    assert.match(outcome.message, /2026-11-22 19-30-00\.mkv/);
    assert.match(outcome.message, /Matroska/);
    assert.match(outcome.message, /MP4/);
    assert.strictEqual(recordings.listParts(recordingsDir, 'live').length, 0);
    assert.strictEqual(pickup.importFile(file).result, 'duplicate');
    assert.strictEqual(pickup.scan({ since: 0 }).length, 0);

    const odd = write(videos, '2026-11-22 19-31-00.avi', Buffer.from('x'));
    assert.strictEqual(pickup.importFile(odd).result, 'unplayable');
});

test('nothing outside the videos folder is read or linked', (t) => {
    const { videos, elsewhere, recordingsDir, pickup, write } = setup(t);
    const outside = write(elsewhere, '2026-11-22 19-30-00.mp4', makeMp4());
    const outcome = pickup.importFile(outside);
    assert.strictEqual(outcome.result, 'outside');
    assert.match(outcome.message, /VIDEOS_DIR/);
    // A path that climbs out through the folder.
    assert.strictEqual(pickup.importFile(path.join(videos, '..', 'elsewhere', path.basename(outside))).result, 'outside');
    // A link in the folder to a file outside, and a link to a folder outside.
    fs.symlinkSync(outside, path.join(videos, 'link.mp4'));
    assert.strictEqual(pickup.importFile(path.join(videos, 'link.mp4')).result, 'outside');
    fs.symlinkSync(elsewhere, path.join(videos, 'dir-link'));
    assert.strictEqual(pickup.importFile(path.join(videos, 'dir-link', path.basename(outside))).result, 'outside');
    // A link to a file that is inside the folder is still refused: only real files.
    const inside = write(videos, '2026-11-22 19-31-00.mp4', makeMp4());
    fs.symlinkSync(inside, path.join(videos, 'inside-link.mp4'));
    assert.strictEqual(pickup.importFile(path.join(videos, 'inside-link.mp4')).result, 'outside');
    // The folder itself, system files, and odd input.
    assert.strictEqual(pickup.importFile(videos).result, 'outside');
    assert.strictEqual(pickup.importFile('/etc/passwd').result, 'outside');
    assert.strictEqual(pickup.importFile(path.join(videos, 'nope.mp4')).result, 'missing');
    assert.strictEqual(pickup.importFile(undefined).result, 'missing');
    assert.strictEqual(pickup.importFile('a\0b').result, 'missing');
    assert.strictEqual(recordings.listParts(recordingsDir, 'live').length, 0);
    assert.strictEqual(fs.existsSync(path.join(recordingsDir, 'live')), false);
});

test('the scan only takes OBS-named, finished, recent files at the top of the folder', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t);
    write(videos, '2026-11-22 19-30-00.mp4', makeMp4({ durationS: 100 }), 600);
    write(videos, '2026-11-22 18-00-00.mp4', makeMp4({ durationS: 100 }), 7200); // before the show
    write(videos, '2026-11-22 19-50-00.mp4', makeMp4({ durationS: 100 }), 3); // still settling
    write(videos, '2026-11-22 19-45-00.mp4', makeMp4({ unfinished: true }), 120); // no moov yet
    write(videos, 'Screen Recording 2026-11-22.mov', makeMp4({ durationS: 100 }), 600); // not OBS
    write(videos, 'holiday.mp4', makeMp4({ durationS: 100 }), 600);
    write(videos, '2026-11-22 19-35-00.txt', Buffer.from('x'), 600);
    fs.mkdirSync(path.join(videos, 'nested'));
    write(path.join(videos, 'nested'), '2026-11-22 19-36-00.mp4', makeMp4({ durationS: 100 }), 600);
    write(videos, '2026-11-22 19-40-00.mkv', Buffer.from([1, 2, 3]), 600);

    const results = pickup.scan({ since: NOW - 3600000 });
    assert.deepStrictEqual(results.map(r => [r.name, r.result]).sort(), [
        ['2026-11-22 19-30-00.mp4', 'added'],
        ['2026-11-22 19-40-00.mkv', 'unplayable']
    ]);
    assert.deepStrictEqual(recordings.listParts(recordingsDir, 'live').map(p => p.name), ['2026-11-22 19-30-00.mp4']);
    // A second scan finds nothing new.
    assert.deepStrictEqual(pickup.scan({ since: NOW - 3600000 }), []);
    // The recording finishing later is picked up by a later scan.
    write(videos, '2026-11-22 19-45-00.mp4', makeMp4({ durationS: 50 }), 120);
    assert.deepStrictEqual(pickup.scan({ since: NOW - 3600000 }).map(r => r.result), ['added']);
});

test('a missing videos folder scans as empty', (t) => {
    const { root, recordingsDir } = setup(t);
    const pickup = createPickup({ videosDir: path.join(root, 'nope'), recordingsDir, now: () => NOW });
    assert.deepStrictEqual(pickup.scan({ since: 0 }), []);
    assert.strictEqual(pickup.importFile(path.join(root, 'nope', 'a.mp4')).result, 'missing');
});

test('where a hard link is not possible the part refers to the video where it is', (t) => {
    const { videos, elsewhere, recordingsDir, pickup, write } = setup(t);
    const file = write(videos, '2026-11-22 19-30-00.mp4', makeMp4({ durationS: 60 }));
    const link = fs.linkSync;
    fs.linkSync = () => { throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' }); };
    let outcome;
    try {
        outcome = pickup.importFile(file);
    } finally {
        fs.linkSync = link;
    }
    assert.strictEqual(outcome.result, 'added');
    const part = recordings.listParts(recordingsDir, 'live')[0];
    assert.strictEqual(part.file, null);
    assert.strictEqual(part.source, fs.realpathSync.native(file));

    // Served only from inside the videos folder.
    assert.strictEqual(recordings.partFile(recordingsDir, 'live', part.id), null);
    assert.strictEqual(recordings.partFile(recordingsDir, 'live', part.id, { externalRoot: elsewhere }), null);
    assert.strictEqual(recordings.partFile(recordingsDir, 'live', part.id, { externalRoot: videos }).path, fs.realpathSync.native(file));

    // Replacing the video with a link out of the folder stops it being served.
    const secret = write(elsewhere, 'secret.mp4', makeMp4());
    fs.rmSync(file);
    fs.symlinkSync(secret, file);
    assert.strictEqual(recordings.partFile(recordingsDir, 'live', part.id, { externalRoot: videos }), null);
    fs.rmSync(file);
    write(videos, '2026-11-22 19-30-00.mp4', makeMp4({ durationS: 60 }));

    // A saved show links it where it can, and removing a part never deletes the video.
    return recordings.copyCollection(recordingsDir, 'live', 'show-1', { externalRoot: videos }).then((count) => {
        assert.strictEqual(count, 1);
        const copy = recordings.listParts(recordingsDir, 'show-1')[0];
        assert.ok(copy.file, 'linked into the saved show');
        assert.strictEqual(fs.statSync(path.join(recordingsDir, 'show-1', copy.file)).ino, fs.statSync(file).ino);
        recordings.removeCollection(recordingsDir, 'live');
        assert.ok(fs.existsSync(file));
        assert.ok(fs.existsSync(path.join(recordingsDir, 'show-1', copy.file)));
    });
});

test('removing a referenced part leaves the video where it is', (t) => {
    const { videos, recordingsDir, pickup, write } = setup(t);
    const file = write(videos, '2026-11-22 19-30-00.mp4', makeMp4({ durationS: 60 }));
    const link = fs.linkSync;
    fs.linkSync = () => { throw Object.assign(new Error('not supported'), { code: 'EPERM' }); };
    try { pickup.importFile(file); } finally { fs.linkSync = link; }
    const part = recordings.listParts(recordingsDir, 'live')[0];
    assert.strictEqual(part.file, null);
    assert.strictEqual(recordings.removePart(recordingsDir, 'live', part.id), true);
    assert.ok(fs.existsSync(file));
});
