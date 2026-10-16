// Recordings uploaded for everyone to watch back on playback.html, kept on the
// server's disk rather than chosen again on every device.
//
// Each set of notes has its own folder, `<dir>/<collection>/`: `live` for the
// live notes, or a saved show's id (saved-shows.js). A recording may come in
// several parts (Vor starts a new file after a stop); every part is one video
// file `<part id>.<ext>`, listed with its start time and length in the
// folder's `recordings.json`. playback-program.js lays the parts out in time.
//
// Saving a show hard-links the live parts into the show's folder (copying
// only where links are not possible), so a reset afterwards, which removes
// the live folder, leaves the show's copy alone. Collection and part ids are
// checked against patterns before they are joined into a path.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { writeBackupFile } = require('./notes-backup');

const MANIFEST = 'recordings.json';
const PART_ID = /^[a-f0-9]{32}$/;
const MAX_NAME = 200;
const MAX_DURATION_S = 48 * 60 * 60;
const TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

const partId = () => crypto.randomBytes(16).toString('hex');

// What a part's upload says about it, checked: { name, ext, type, startAt,
// duration }, or { error }. startAt is ms since the epoch (or absent when the
// file name has no Vor date and nobody has matched it yet); duration seconds.
function cleanPartInfo({ name, type, startAt, duration }) {
    const clean = typeof name === 'string'
        ? name.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
    if (!clean) return { error: 'The video needs a file name.' };
    const ext = (/\.([a-z0-9]+)$/i.exec(clean) || [])[1];
    const kind = ext && ext.toLowerCase();
    if (!TYPES[kind]) return { error: 'Only .mp4, .mov, .m4v and .webm videos can be uploaded.' };
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_DURATION_S) return { error: 'The video\'s length could not be read.' };
    const start = cleanStart(startAt);
    if (start === undefined) return { error: 'The video\'s start time is not a time.' };
    // The browser's own type when it gave one that is a video, else from the name.
    const mime = typeof type === 'string' && /^video\/[a-z0-9.+-]+$/i.test(type) ? type.toLowerCase() : TYPES[kind];
    return { name: clean, ext: kind, type: mime, startAt: start, duration: seconds };
}

// An ISO start time, null for none, undefined when it is not a time.
function cleanStart(startAt) {
    if (startAt === null || startAt === undefined || startAt === '') return null;
    const ms = typeof startAt === 'number' ? startAt : Number(startAt);
    const at = Number.isFinite(ms) ? new Date(ms) : new Date(NaN);
    return Number.isFinite(at.getTime()) && at.getFullYear() > 2000 && at.getFullYear() < 2200 ? at.toISOString() : undefined;
}

function folder(dir, collection) {
    return path.join(dir, collection);
}

function readManifest(dir, collection) {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(folder(dir, collection), MANIFEST), 'utf8'));
        return Array.isArray(data.parts) ? data.parts.filter(p => p && PART_ID.test(p.id)) : [];
    } catch (error) {
        return [];
    }
}

function writeManifest(dir, collection, parts) {
    fs.mkdirSync(folder(dir, collection), { recursive: true });
    writeBackupFile(folder(dir, collection), MANIFEST, JSON.stringify({ parts }, null, 2));
}

// The parts, earliest first (those with no start time in upload order after them).
function listParts(dir, collection) {
    const at = (p) => (p.startAt ? Date.parse(p.startAt) : Infinity);
    return readManifest(dir, collection)
        .sort((a, b) => at(a) - at(b) || (a.uploadedAt < b.uploadedAt ? -1 : 1));
}

// The file to send for a part, or null.
function partFile(dir, collection, id) {
    if (!PART_ID.test(String(id))) return null;
    const part = readManifest(dir, collection).find(p => p.id === id);
    return part ? { path: path.join(folder(dir, collection), part.file), type: part.type } : null;
}

// Streams `body` (the request) into a new part. Rejects with an error whose
// `status` is 413 when it passes `maxBytes`; nothing is kept from a failed
// or interrupted upload.
async function addPart(dir, collection, body, info, { maxBytes, uploadedBy } = {}) {
    const id = partId();
    const file = `${id}.${info.ext}`;
    const target = folder(dir, collection);
    fs.mkdirSync(target, { recursive: true });
    const temp = path.join(target, `.${file}.upload`);
    let size = 0;
    const limit = new Transform({
        transform(chunk, encoding, done) {
            size += chunk.length;
            if (maxBytes && size > maxBytes) {
                const error = new Error('The video is too large.');
                error.status = 413;
                return done(error);
            }
            done(null, chunk);
        }
    });
    try {
        await pipeline(body, limit, fs.createWriteStream(temp));
        if (!size) throw Object.assign(new Error('The video is empty.'), { status: 400 });
        fs.renameSync(temp, path.join(target, file));
    } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
    }
    const part = {
        id, file, name: info.name, type: info.type, size, startAt: info.startAt, duration: info.duration,
        uploadedAt: new Date().toISOString(), uploadedBy: uploadedBy || null
    };
    writeManifest(dir, collection, [...readManifest(dir, collection), part]);
    return part;
}

// Changes a part's start time (matched by hand on playback.html). Returns the
// part, null if there is no such part, or undefined if startAt is not a time.
function setPartStart(dir, collection, id, startAt) {
    const start = cleanStart(startAt);
    if (start === undefined) return undefined;
    const parts = readManifest(dir, collection);
    const part = parts.find(p => p.id === id);
    if (!part) return null;
    part.startAt = start;
    writeManifest(dir, collection, parts);
    return part;
}

function removePart(dir, collection, id) {
    const parts = readManifest(dir, collection);
    const part = parts.find(p => p.id === id);
    if (!part) return false;
    writeManifest(dir, collection, parts.filter(p => p !== part));
    fs.rmSync(path.join(folder(dir, collection), part.file), { force: true });
    return true;
}

// Every part of `from` into `to` (a new saved show), hard-linked where the
// disk allows it. Resolves to the number of parts.
async function copyCollection(dir, from, to) {
    const parts = readManifest(dir, from);
    if (!parts.length) return 0;
    fs.mkdirSync(folder(dir, to), { recursive: true });
    for (const part of parts) {
        const source = path.join(folder(dir, from), part.file);
        const target = path.join(folder(dir, to), part.file);
        try {
            await fs.promises.link(source, target);
        } catch (error) {
            if (error.code === 'EEXIST') continue;
            await fs.promises.copyFile(source, target);
        }
    }
    writeManifest(dir, to, [...readManifest(dir, to), ...parts]);
    return parts.length;
}

function removeCollection(dir, collection) {
    fs.rmSync(folder(dir, collection), { recursive: true, force: true });
}

// Each collection's part count, for the list of saved shows.
function partCounts(dir) {
    const counts = new Map();
    let names = [];
    try { names = fs.readdirSync(dir); } catch (error) { return counts; }
    for (const name of names) {
        const parts = readManifest(dir, name);
        if (parts.length) counts.set(name, parts.length);
    }
    return counts;
}

module.exports = {
    PART_ID, cleanPartInfo, listParts, partFile, addPart, setPartStart, removePart,
    copyCollection, removeCollection, partCounts
};
