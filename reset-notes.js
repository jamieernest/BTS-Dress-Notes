// Notes kept from a reset: "Reset all notes and chat" (or "Save and reset")
// first writes the live notes here, so a reset done by mistake can be undone
// from the config page for KEEP_MS (3 days). There is no way to delete one
// from the UI; it goes only once its time runs out (prune()). Chat and videos
// are not kept.
//
// Each reset is one file, `<time>.json`, holding what the JSON export holds
// plus `resetAt` and `resetBy`. The file name (without .json) is the id, and
// age comes from it, not from mtime; the id pattern is the only thing a
// request's id is checked against, so a path outside the folder can never be
// built from one.

const fs = require('node:fs');
const path = require('node:path');
const { checkBackup, writeBackupFile } = require('./notes-backup');

const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const ID = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

const isResetId = (id) => typeof id === 'string' && ID.test(id);
const resetId = (date) => date.toISOString().replace(/[:.]/g, '-');

// The time an id was written, or null if it is not an id.
function resetTime(id) {
    const m = typeof id === 'string' && ID.exec(id);
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

const expired = (id, now, keepMs) => now - resetTime(id) >= keepMs;

function summary(id, data, keepMs) {
    return {
        id,
        resetAt: data.resetAt,
        resetBy: data.resetBy,
        expiresAt: new Date(resetTime(id) + keepMs).toISOString(),
        totalNotes: data.notes.length
    };
}

// Writes the notes being reset (the JSON export's shape). Synchronous, so the
// reset that follows cannot run before they are on disk; throws if they can't
// be written, and the reset must not go ahead. Two in the same millisecond get
// the next free one.
function keepReset(dir, exportData, resetBy, date = new Date()) {
    fs.mkdirSync(dir, { recursive: true });
    while (fs.existsSync(path.join(dir, `${resetId(date)}.json`))) date = new Date(date.getTime() + 1);
    const id = resetId(date);
    const data = { resetAt: date.toISOString(), resetBy, ...exportData };
    writeBackupFile(dir, `${id}.json`, JSON.stringify(data, null, 2));
    return id;
}

// The kept reset with this id, or null if there is none, it has run out, or
// the id is not one.
async function readReset(dir, id, now = Date.now(), keepMs = KEEP_MS) {
    if (!isResetId(id) || expired(id, now, keepMs)) return null;
    try {
        const data = JSON.parse(await fs.promises.readFile(path.join(dir, `${id}.json`), 'utf8'));
        return checkBackup(data) ? null : data;
    } catch (error) {
        return null;
    }
}

async function ids(dir) {
    try {
        return (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(isResetId);
    } catch (error) {
        return [];
    }
}

// Every kept reset that hasn't run out, newest first, without the notes.
async function listResets(dir, now = Date.now(), keepMs = KEEP_MS) {
    const list = await Promise.all((await ids(dir)).map(async id => {
        const data = await readReset(dir, id, now, keepMs);
        return data && summary(id, data, keepMs);
    }));
    return list.filter(Boolean).sort((a, b) => (a.id < b.id ? 1 : -1));
}

// Deletes the kept resets whose time has run out. Returns the ids removed.
async function prune(dir, now = Date.now(), keepMs = KEEP_MS) {
    const gone = (await ids(dir)).filter(id => expired(id, now, keepMs));
    await Promise.all(gone.map(id => fs.promises.rm(path.join(dir, `${id}.json`), { force: true })));
    return gone;
}

module.exports = { KEEP_MS, isResetId, resetTime, keepReset, readReset, listResets, prune };
