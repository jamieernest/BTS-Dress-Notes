// Notes backups: writing them so a crash cannot leave a half-written file, and
// finding the newest one that is safe to load when the server starts.
//
// A backup is only trusted if it is recent (a restart after a dress should
// start clean, not bring last night's notes back) and passes checkBackup().
// Age and order come from the timestamp in the file name, which is taken when
// the snapshot is made, not from the file's mtime: a slow asynchronous write
// that finishes after a later backup must not outrank it.

const fs = require('node:fs');
const path = require('node:path');

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // a dress restart is quick; a backup older than this is a past show
const NAME = /^backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;

function backupFilename(date = new Date()) {
    return `backup-${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

// When the snapshot in `filename` was made (ms since epoch), or null if the
// name is not a backup's. Temporary files never match, so they are never read.
function backupTime(filename) {
    const m = NAME.exec(filename);
    if (!m) return null;
    const time = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
    return Number.isNaN(time) ? null : time;
}

// Why `data` cannot be loaded, or null if it can. `data` is the parsed JSON.
function checkBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'not a JSON object';
    if (!Array.isArray(data.notes)) return 'no notes array';
    // The backup records how many notes it holds, so a file cut short but still
    // valid JSON, or one edited by hand, is caught here.
    if (data.totalNotes !== undefined && data.totalNotes !== data.notes.length) {
        return `holds ${data.notes.length} notes but says ${data.totalNotes}`;
    }
    const ids = new Set();
    for (const [i, note] of data.notes.entries()) {
        if (!note || typeof note !== 'object' || Array.isArray(note)) return `note ${i} is not an object`;
        if (typeof note.id !== 'string' || !note.id) return `note ${i} has no id`;
        if (ids.has(note.id)) return `note id ${note.id} appears twice`;
        ids.add(note.id);
        if (typeof note.text !== 'string') return `note ${note.id} has no text`;
        if (typeof note.timestamp !== 'string' || Number.isNaN(Date.parse(note.timestamp))) {
            return `note ${note.id} has no valid timestamp`;
        }
        if (note.userId !== undefined && typeof note.userId !== 'string') return `note ${note.id} userId is not a string`;
        if (note.tags !== undefined && !Array.isArray(note.tags)) return `note ${note.id} tags are not a list`;
        if (note.timecode !== undefined && (!note.timecode || typeof note.timecode !== 'object')) {
            return `note ${note.id} timecode is not an object`;
        }
        if (note.comments !== undefined) {
            if (!Array.isArray(note.comments)) return `note ${note.id} comments are not a list`;
            for (const c of note.comments) {
                if (!c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.text !== 'string') {
                    return `note ${note.id} has a malformed comment`;
                }
            }
        }
    }
    if (data.tags !== undefined) {
        if (!Array.isArray(data.tags)) return 'tags are not a list';
        for (const tag of data.tags) {
            if (!tag || typeof tag !== 'object' || typeof tag.id !== 'string' || typeof tag.name !== 'string') {
                return 'a tag is malformed';
            }
        }
    }
    if (data.authors !== undefined) {
        if (!Array.isArray(data.authors)) return 'authors are not a list';
        for (const a of data.authors) {
            if (!a || typeof a !== 'object' || typeof a.userId !== 'string' || typeof a.name !== 'string') {
                return 'an author is malformed';
            }
        }
    }
    return null;
}

// Who wrote the notes: one { userId, name } per Keycloak identity (the token
// subject, which is what the author-only edit rule compares), with the display
// name last seen on one of that person's notes as a label only. Notes without a
// userId have no author and are left out.
function authorsOf(notes) {
    const names = new Map();
    for (const n of notes) if (n.userId) names.set(n.userId, n.user || names.get(n.userId) || n.userId);
    return [...names].map(([userId, name]) => ({ userId, name }));
}

// Gives every note by a known author that author's recorded display name, so a
// person's notes show one name after a restore. A userId that is not a recorded
// author (a socket id from a backup written before authors were Keycloak
// identities) is dropped, leaving the note ownerless and editable by anyone.
function applyAuthors(notes, authors = []) {
    const names = new Map(authors.map((a) => [a.userId, a.name]));
    for (const n of notes) {
        if (!n.userId) continue;
        if (names.has(n.userId)) n.user = names.get(n.userId);
        else delete n.userId;
    }
    return notes;
}

// Finds the newest backup in `dir` that is under `maxAgeMs` old and passes
// checkBackup(), trying the next newest when one fails. Never throws.
// Returns { file, data, skipped } on success, else { file: null, reason, skipped },
// where `skipped` lists { file, reason } for every candidate that was rejected.
function findRestorableBackup(dir, { now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
    const skipped = [];
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch (error) {
        const reason = error.code === 'ENOENT' ? 'no backups folder yet' : `could not read the backups folder: ${error.message}`;
        return { file: null, reason, skipped };
    }
    const candidates = names
        .map((file) => ({ file, time: backupTime(file) }))
        .filter((c) => c.time !== null)
        .sort((a, b) => b.time - a.time || (a.file < b.file ? 1 : -1));
    if (candidates.length === 0) return { file: null, reason: 'no backup files', skipped };

    let recent = 0;
    for (const { file, time } of candidates) {
        if (now - time > maxAgeMs) break; // sorted newest first, so the rest are older still
        recent++;
        try {
            const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            const problem = checkBackup(data);
            if (!problem) return { file, data, skipped };
            skipped.push({ file, reason: problem });
        } catch (error) {
            skipped.push({ file, reason: `unreadable or not valid JSON (${error.message})` });
        }
    }
    const reason = recent === 0
        ? `newest backup ${candidates[0].file} is older than ${Math.round(maxAgeMs / 60000)} minutes`
        : `none of the ${recent} backups from the last ${Math.round(maxAgeMs / 60000)} minutes passed the check`;
    return { file: null, reason, skipped };
}

// Writes `text` to dir/filename through a temporary file and a rename, so the
// file only ever appears whole. With `callback` the write is asynchronous,
// otherwise it completes before returning (the crash and shutdown path, which
// exits straight after). The temporary name does not look like a backup.
function writeBackupFile(dir, filename, text, callback) {
    const final = path.join(dir, filename);
    const temp = path.join(dir, `.${filename}.${process.pid}.tmp`);
    if (!callback) {
        try {
            fs.writeFileSync(temp, text);
            fs.renameSync(temp, final);
        } catch (error) {
            fs.rmSync(temp, { force: true });
            throw error;
        }
        return;
    }
    fs.writeFile(temp, text, (error) => {
        if (error) return fs.rm(temp, { force: true }, () => callback(error));
        fs.rename(temp, final, (renameError) => {
            if (renameError) return fs.rm(temp, { force: true }, () => callback(renameError));
            callback(null);
        });
    });
}

module.exports = { MAX_AGE_MS, authorsOf, applyAuthors, backupFilename, backupTime, checkBackup, findRestorableBackup, writeBackupFile };
