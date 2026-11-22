// Recordings OBS saves in the machine's videos folder, added to the live
// notes' recording (recordings.js) without anyone uploading them.
//
// Two ways in: OBS says where it saved a recording when it stops (importFile,
// the one to trust), and a scan of the folder finds recordings OBS finished
// while this server was down or not connected (scan).
//
// Nothing outside the videos folder is ever read, linked or served: a path is
// resolved (links followed) and must still be inside the folder, and a link as
// the file itself is refused. The scan is deliberately narrow, since the
// folder holds everything else the person records: only the top level, only
// OBS's default `YYYY-MM-DD hh-mm-ss` names, and only files finished since the
// current live notes began. A file is added once: `.obs-imported.json` in the
// recordings folder remembers every file handled, even after the part is
// removed or the show is reset, so the next scan does not bring it back.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const recordings = require('./recordings');
const { readMp4Info } = require('./mp4-info');
const { writeBackupFile } = require('./notes-backup');

const LEDGER = '.obs-imported.json';
const LEDGER_MAX = 1000;
const OBS_NAME = /^\d{4}-\d{2}-\d{2}[ _T]\d{2}[-_.]\d{2}[-_.]\d{2}/;
const MP4_FAMILY = new Set(['mp4', 'm4v', 'mov']);
// Containers OBS can record to that no browser plays.
const UNPLAYABLE = { mkv: 'Matroska (.mkv)', flv: 'Flash video (.flv)', ts: 'MPEG-TS (.ts)', m3u8: 'HLS (.m3u8)' };
const SETTLE_MS = 10000;
const UNREADABLE_AFTER_MS = 60000;

// The OS user's own videos folder: Movies on macOS, Videos elsewhere.
function defaultVideosDir(platform = process.platform, home = os.homedir()) {
    return path.join(home, platform === 'darwin' ? 'Movies' : 'Videos');
}

const extensionOf = (file) => path.extname(file).slice(1).toLowerCase();

function unplayableMessage(name, ext) {
    return `OBS saved "${name}" as ${UNPLAYABLE[ext]}, which browsers cannot play, so it was not added. ` +
        'In OBS set Settings > Output > Recording > Recording Format to MP4 (or Fragmented MP4) and record again; ' +
        'File > Remux Recordings can turn this file into an MP4, which is then picked up.';
}

// `videosDir`: the folder everything must stay inside. `recordingsDir`: the
// app's recordings folder (RECORDINGS_DIR). `now`: for tests.
function createPickup({ videosDir, recordingsDir, collection = 'live', now = Date.now, settleMs = SETTLE_MS }) {
    const ledgerPath = path.join(recordingsDir, LEDGER);

    function readLedger() {
        try {
            const data = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
            return Array.isArray(data.files) ? data.files.filter(f => f && typeof f.path === 'string') : [];
        } catch (error) {
            return [];
        }
    }

    function remember(entry) {
        const files = [...readLedger(), entry].slice(-LEDGER_MAX);
        fs.mkdirSync(recordingsDir, { recursive: true });
        writeBackupFile(recordingsDir, LEDGER, JSON.stringify({ files }, null, 2));
    }

    const handled = (key) => readLedger().some(f => f.key === key);

    // Adds the recording at `file` (a path OBS reported, or one the scan found).
    // `hint`: { startedAt } in ms when the server saw the recording begin.
    // Resolves synchronously to { result, ... }; result is 'added', 'duplicate',
    // 'unplayable', 'outside', 'missing', 'unfinished', 'unreadable' or 'error'.
    function importFile(file, hint = {}) {
        if (typeof file !== 'string' || !file || file.includes('\0')) return { result: 'missing', message: 'OBS did not say where the recording is.' };
        const name = path.basename(file);
        const real = recordings.resolveInside(videosDir, file);
        if (!real) {
            let exists = true;
            try { fs.lstatSync(file); } catch (error) { exists = false; }
            if (!exists) return { result: 'missing', name, message: `OBS's recording "${name}" was not found.` };
            return {
                result: 'outside', name,
                message: `OBS saved "${name}" outside the videos folder (${videosDir}), so it was not added. ` +
                    'Record to that folder in OBS, or set VIDEOS_DIR to the folder OBS records to.'
            };
        }
        let stat;
        try {
            stat = fs.statSync(real, { bigint: true });
        } catch (error) {
            return { result: 'missing', name, message: `OBS's recording "${name}" was not found.` };
        }
        const key = stat.ino ? `${stat.dev}:${stat.ino}` : `${real}:${stat.size}`;
        if (handled(key)) return { result: 'duplicate', name };

        const ext = extensionOf(real);
        const mtimeMs = Number(stat.mtimeMs);
        const record = (result) => remember({ path: real, key, size: Number(stat.size), result, at: new Date(now()).toISOString() });
        if (Object.hasOwn(UNPLAYABLE, ext)) {
            record('unplayable');
            return { result: 'unplayable', name, message: unplayableMessage(name, ext) };
        }
        if (!Object.hasOwn(recordings.TYPES, ext)) {
            record('unplayable');
            return { result: 'unplayable', name, message: `"${name}" is not a video type browsers play (.mp4, .mov, .m4v or .webm), so it was not added.` };
        }

        // The file's own length when it can be read; else (a fragmented MP4, or a type
        // not read here) the time OBS says the recording took, else how long the
        // file was written for. A file still being written has none of these yet.
        let duration = null;
        let fragmented = !MP4_FAMILY.has(ext);
        if (MP4_FAMILY.has(ext)) {
            const info = readMp4Info(real);
            const age = now() - mtimeMs;
            if (info.durationS) duration = info.durationS;
            else if (info.noDuration) fragmented = true;
            else if (info.unreadable && age > UNREADABLE_AFTER_MS) {
                record('unreadable');
                return { result: 'unreadable', name, message: `"${name}" could not be read as a video, so it was not added.` };
            }
        }
        if (!duration && fragmented) {
            const started = hint.startedAt || Number(stat.birthtimeMs);
            if (started && mtimeMs > started) duration = (mtimeMs - started) / 1000;
        }
        if (!duration) return { result: 'unfinished', name, message: `"${name}" is not finished yet.` };

        const startAt = hint.startedAt || mtimeMs - duration * 1000;
        const info = recordings.cleanPartInfo({ name, startAt, duration });
        if (info.error) return { result: 'error', name, message: info.error };
        let part;
        try {
            part = recordings.addLinkedPart(recordingsDir, collection, real, { ...info, size: Number(stat.size) }, { uploadedBy: 'OBS' });
        } catch (error) {
            return { result: 'error', name, message: `"${name}" could not be added: ${error.message}` };
        }
        record('added');
        return { result: 'added', name, part };
    }

    // The same, for a file OBS has only just closed: a few more tries while it finishes.
    async function importFinished(file, hint, { tries = 6, delayMs = 1000 } = {}) {
        let outcome = importFile(file, hint);
        for (let i = 1; i < tries && (outcome.result === 'unfinished' || outcome.result === 'missing'); i++) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            outcome = importFile(file, hint);
        }
        return outcome;
    }

    // Looks in the videos folder for OBS recordings finished since `since` (ms)
    // that have not been handled; returns what happened to each new one.
    function scan({ since = 0 } = {}) {
        let names;
        try {
            names = fs.readdirSync(videosDir, { withFileTypes: true });
        } catch (error) {
            return [];
        }
        const results = [];
        for (const entry of names) {
            if (!entry.isFile() || !OBS_NAME.test(entry.name)) continue;
            const ext = extensionOf(entry.name);
            if (!Object.hasOwn(UNPLAYABLE, ext) && !MP4_FAMILY.has(ext) && ext !== 'webm') continue;
            const file = path.join(videosDir, entry.name);
            let mtimeMs;
            try { mtimeMs = fs.statSync(file).mtimeMs; } catch (error) { continue; }
            if (mtimeMs < since || now() - mtimeMs < settleMs) continue;
            const outcome = importFile(file);
            if (outcome.result !== 'duplicate' && outcome.result !== 'unfinished') results.push(outcome);
        }
        return results;
    }

    return { importFile, importFinished, scan };
}

module.exports = { createPickup, defaultVideosDir, unplayableMessage, UNPLAYABLE, OBS_NAME, LEDGER };
