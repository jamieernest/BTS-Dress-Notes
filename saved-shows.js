// Saved shows: a dress's notes kept on the server under a name ("BUSMS Overture
// Dress Notes 2026") from the config page, to be opened later on Past notes.
// Unlike backups (notes-backup.js) they are never loaded back into the live
// notes and never deleted by age.
//
// Each show is one file, `<time>-<slug>.json`, holding what the JSON export
// holds plus `name` and `savedAt`. The file name (without .json) is the show's
// id; the id pattern is the only thing a request's id is checked against, so a
// path outside the folder can never be built from one.

const fs = require('node:fs');
const path = require('node:path');
const { checkBackup, writeBackupFile } = require('./notes-backup');

const ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const MAX_NAME = 100;

// The name as stored: trimmed, inner whitespace collapsed, at most MAX_NAME
// characters. Null if nothing usable is left.
function cleanShowName(name) {
    if (typeof name !== 'string') return null;
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean ? clean.slice(0, MAX_NAME).trim() : null;
}

const isShowId = (id) => typeof id === 'string' && ID.test(id);

function showId(name, date = new Date()) {
    const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return `${date.toISOString().replace(/[:.]/g, '-')}${slug ? `-${slug}` : ''}`;
}

// What a list of shows shows, without the notes.
function summary(id, data) {
    return { id, name: data.name, savedAt: data.savedAt, totalNotes: data.notes.length };
}

// Writes `exportData` (the JSON export's shape) as a new show named `name`
// (already cleaned) and returns its summary. Synchronous, so a reset straight
// afterwards cannot run before the show is on disk.
function saveShow(dir, name, exportData, date = new Date()) {
    const id = showId(name, date);
    const data = { name, savedAt: date.toISOString(), ...exportData };
    fs.mkdirSync(dir, { recursive: true });
    writeBackupFile(dir, `${id}.json`, JSON.stringify(data, null, 2));
    return summary(id, data);
}

// The show with this id, or null if there is none (or the id is not one).
async function readShow(dir, id) {
    if (!isShowId(id)) return null;
    try {
        const data = JSON.parse(await fs.promises.readFile(path.join(dir, `${id}.json`), 'utf8'));
        return checkBackup(data) || typeof data.name !== 'string' ? null : data;
    } catch (error) {
        return null;
    }
}

// Every readable show's summary, newest first. A damaged file is left out.
async function listShows(dir) {
    let files;
    try {
        files = await fs.promises.readdir(dir);
    } catch (error) {
        return [];
    }
    const ids = files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(id => ID.test(id));
    const shows = await Promise.all(ids.map(async id => {
        const data = await readShow(dir, id);
        return data && summary(id, data);
    }));
    return shows.filter(Boolean).sort((a, b) => (a.id < b.id ? 1 : -1));
}

module.exports = { MAX_NAME, cleanShowName, isShowId, showId, saveShow, readShow, listShows };
