// Shared chat stickers, kept as raster files with a small manifest.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns');
const net = require('node:net');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { writeBackupFile } = require('./notes-backup');

const MANIFEST = 'stickers.json';
const STICKER_ID = /^[a-f0-9]{32}$/;
const MAX_NAME = 200;
const TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
};
const MIME_TYPES = new Set(Object.values(TYPES));
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15000;

const stickerId = () => crypto.randomBytes(16).toString('hex');

function cleanName(name) {
    return typeof name === 'string'
        ? name.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
        : '';
}

function cleanInfo(name, type) {
    const clean = cleanName(name);
    if (!clean) return { error: 'The sticker needs a file name.' };
    const extMatch = /\.([a-z0-9]+)$/i.exec(clean);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    if (!Object.hasOwn(TYPES, ext)) {
        return { error: 'Only PNG, JPEG, GIF and WebP stickers can be uploaded.' };
    }
    if (typeof type === 'string' && MIME_TYPES.has(type.toLowerCase()) &&
        TYPES[ext] !== type.toLowerCase()) {
        return { error: 'The sticker file type does not match its name.' };
    }
    return { name: clean, ext, type: TYPES[ext] };
}

function detectImageType(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;
    if (buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (buffer.length >= 3 &&
        buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
    if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return null;
}

function ipv4InRange(address, prefix, bits) {
    const octets = address.split('.').map(Number);
    const value = octets.reduce((total, octet) => (total * 256) + octet, 0);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value >>> 0) & mask) === ((prefix >>> 0) & mask);
}

function blockedIpv4(address) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
    return ipv4InRange(address, 0x00000000, 8) ||
        ipv4InRange(address, 0x0a000000, 8) ||
        ipv4InRange(address, 0x64400000, 10) ||
        ipv4InRange(address, 0x7f000000, 8) ||
        ipv4InRange(address, 0xa9fe0000, 16) ||
        ipv4InRange(address, 0xac100000, 12) ||
        ipv4InRange(address, 0xc0000000, 24) ||
        ipv4InRange(address, 0xc0000200, 24) ||
        ipv4InRange(address, 0xc0a80000, 16) ||
        ipv4InRange(address, 0xc6336400, 24) ||
        ipv4InRange(address, 0xc8000000, 24) ||
        ipv4InRange(address, 0xc0000009, 32) ||
        ipv4InRange(address, 0xe0000000, 4) ||
        ipv4InRange(address, 0xf0000000, 4);
}

function blockedIpv6(address) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (/^::ffff:[0-9a-f.:]+$/i.test(lower)) {
        const ipv4 = lower.split(':').pop();
        return net.isIPv4(ipv4) ? blockedIpv4(ipv4) : true;
    }
    return lower.startsWith('fc') || lower.startsWith('fd') ||
        lower.startsWith('fe8') || lower.startsWith('fe9') ||
        lower.startsWith('fea') || lower.startsWith('feb') ||
        lower.startsWith('ff');
}

async function validatePublicUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return { error: 'The URL is invalid.' };
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username || parsed.password || !parsed.hostname) {
        return { error: 'The URL is invalid.' };
    }
    if (parsed.hostname.toLowerCase() === 'localhost' || parsed.hostname.toLowerCase().endsWith('.localhost')) {
        return { error: 'Local network links cannot be downloaded.' };
    }
    const ipVersion = net.isIP(parsed.hostname);
    if (ipVersion === 4 && blockedIpv4(parsed.hostname)) {
        return { error: 'Local network links cannot be downloaded.' };
    }
    if (ipVersion === 6 && blockedIpv6(parsed.hostname)) {
        return { error: 'Local network links cannot be downloaded.' };
    }
    if (!ipVersion) {
        try {
            const addresses = await dns.promises.lookup(parsed.hostname, { all: true, verbatim: true });
            if (!addresses.length ||
                addresses.some(({ address }) =>
                    (net.isIPv4(address) && blockedIpv4(address)) ||
                    (net.isIPv6(address) && blockedIpv6(address)))) {
                return { error: 'Local network links cannot be downloaded.' };
            }
        } catch (_) {
            return { error: 'The host could not be reached.' };
        }
    }
    return { url: parsed };
}

async function fetchSafe(url, { accept = '*/*', maxBytes = 5 * 1024 ** 2, timeoutMs = FETCH_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS } = {}) {
    let current = url;
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
        const validated = await validatePublicUrl(current);
        if (validated.error) throw Object.assign(new Error(validated.error), { status: 400 });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetch(validated.url.toString(), {
                redirect: 'manual',
                signal: controller.signal,
                headers: { Accept: accept }
            });
        } catch (_) {
            clearTimeout(timer);
            throw Object.assign(new Error('The remote image could not be downloaded.'), { status: 502 });
        }

        if (response.status >= 300 && response.status < 400) {
            clearTimeout(timer);
            if (redirects === maxRedirects) {
                throw Object.assign(new Error('The remote image redirected too many times.'), { status: 502 });
            }
            const location = response.headers.get('location');
            if (!location) throw Object.assign(new Error('The remote image redirect was invalid.'), { status: 502 });
            try {
                current = new URL(location, validated.url).toString();
            } catch (_) {
                throw Object.assign(new Error('The remote image redirect was invalid.'), { status: 502 });
            }
            continue;
        }
        if (!response.ok) {
            clearTimeout(timer);
            throw Object.assign(new Error('The remote image could not be downloaded.'), { status: 502 });
        }
        if (Number(response.headers.get('content-length')) > maxBytes) {
            clearTimeout(timer);
            throw Object.assign(new Error('The sticker is too large.'), { status: 413 });
        }
        if (!response.body) {
            clearTimeout(timer);
            throw Object.assign(new Error('The remote image could not be downloaded.'), { status: 502 });
        }

        let bytes;
        try {
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > maxBytes) {
                    await reader.cancel();
                    throw Object.assign(new Error('The sticker is too large.'), { status: 413 });
                }
                chunks.push(Buffer.from(value));
            }
            bytes = Buffer.concat(chunks, size);
        } catch (error) {
            clearTimeout(timer);
            if (error.status) throw error;
            throw Object.assign(new Error('The remote image could not be downloaded.'), { status: 502 });
        }
        clearTimeout(timer);
        return {
            url: validated.url,
            status: response.status,
            headers: response.headers,
            body: bytes
        };
    }
    throw Object.assign(new Error('The remote image redirected too many times.'), { status: 502 });
}

function readManifest(dir) {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
        if (!Array.isArray(data.stickers)) return [];
        return data.stickers.filter(sticker => {
            if (!sticker || !STICKER_ID.test(String(sticker.id)) ||
                typeof sticker.name !== 'string' || typeof sticker.type !== 'string') return false;
            if (!MIME_TYPES.has(sticker.type)) return false;
            if (typeof sticker.sourceUrl === 'string') {
                try {
                    const url = new URL(sticker.sourceUrl);
                    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname &&
                        !url.username && !url.password &&
                        typeof sticker.type === 'string';
                } catch (_) {
                    return false;
                }
            }
            if (typeof sticker.file !== 'string') return false;
            const ext = path.extname(sticker.file).slice(1).toLowerCase();
            return sticker.file === `${sticker.id}.${ext}` &&
                Object.hasOwn(TYPES, ext) &&
                TYPES[ext] === sticker.type;
        });
    } catch (error) {
        return [];
    }
}

function writeManifest(dir, stickers) {
    fs.mkdirSync(dir, { recursive: true });
    writeBackupFile(dir, MANIFEST, JSON.stringify({ stickers }, null, 2));
}

function ownersOf(sticker) {
    if (Array.isArray(sticker.ownerIds)) return sticker.ownerIds.filter(id => typeof id === 'string' && id);
    return typeof sticker.ownerId === 'string' && sticker.ownerId ? [sticker.ownerId] : [];
}

function list(dir, userId) {
    if (typeof userId !== 'string' || !userId) return [];
    return readManifest(dir).filter(sticker => ownersOf(sticker).includes(userId)).sort((a, b) => {
        const aSequence = a.lastUsedSequenceBy && Number(a.lastUsedSequenceBy[userId]) || 0;
        const bSequence = b.lastUsedSequenceBy && Number(b.lastUsedSequenceBy[userId]) || 0;
        if (aSequence !== bSequence) return bSequence - aSequence;
        const aUsed = a.lastUsedBy && a.lastUsedBy[userId];
        const bUsed = b.lastUsedBy && b.lastUsedBy[userId];
        const used = (Date.parse(bUsed) || 0) - (Date.parse(aUsed) || 0);
        if (used) return used;
        const uploaded = (Date.parse(b.uploadedAt) || 0) - (Date.parse(a.uploadedAt) || 0);
        if (uploaded) return uploaded;
        return String(a.name).localeCompare(String(b.name));
    });
}

function touch(dir, id, userId) {
    if (!STICKER_ID.test(String(id)) || typeof userId !== 'string' || !userId) return null;
    const stickers = readManifest(dir);
    const sticker = stickers.find(item => item.id === id);
    if (!sticker || !ownersOf(sticker).includes(userId)) return null;
    sticker.lastUsedBy = sticker.lastUsedBy && typeof sticker.lastUsedBy === 'object' ? sticker.lastUsedBy : {};
    sticker.lastUsedBy[userId] = new Date().toISOString();
    sticker.lastUsedSequenceBy = sticker.lastUsedSequenceBy && typeof sticker.lastUsedSequenceBy === 'object'
        ? sticker.lastUsedSequenceBy : {};
    const sequence = stickers.reduce((highest, item) => {
        const value = item.lastUsedSequenceBy && Number(item.lastUsedSequenceBy[userId]);
        return Number.isFinite(value) ? Math.max(highest, value) : highest;
    }, 0);
    sticker.lastUsedSequenceBy[userId] = sequence + 1;
    writeManifest(dir, stickers);
    return sticker;
}

function link(dir, id, userId) {
    if (!STICKER_ID.test(String(id)) || typeof userId !== 'string' || !userId) return null;
    const stickers = readManifest(dir);
    const sticker = stickers.find(item => item.id === id);
    if (!sticker || !stickerFile(dir, id)) return null;
    const ownerIds = ownersOf(sticker);
    if (!ownerIds.includes(userId)) {
        sticker.ownerIds = [...ownerIds, userId];
        delete sticker.ownerId;
        writeManifest(dir, stickers);
    }
    return sticker;
}

function inLibrary(dir, id, userId) {
    if (!STICKER_ID.test(String(id)) || typeof userId !== 'string' || !userId) return false;
    const sticker = readManifest(dir).find(item => item.id === id);
    return !!sticker && ownersOf(sticker).includes(userId);
}

function stickerFile(dir, id, userId) {
    if (!STICKER_ID.test(String(id))) return null;
    const sticker = readManifest(dir).find(item => item.id === id);
    if (!sticker) return null;
    if (typeof sticker.file === 'string') {
        const file = path.join(dir, sticker.file);
        try {
            if (!fs.statSync(file).isFile()) return null;
            const sample = fs.readFileSync(file, { encoding: null }).subarray(0, 32);
            if (detectImageType(sample) !== sticker.type) return null;
            return { path: file, type: sticker.type };
        } catch (error) {}
    }
    if (typeof sticker.sourceUrl === 'string') {
        return { redirect: sticker.sourceUrl, type: sticker.type || 'image/gif' };
    }
    return null;
}

const addQueues = new Map();

async function add(dir, body, info, { maxBytes, uploadedBy, uploadedById } = {}) {
    const previous = addQueues.get(dir) || Promise.resolve();
    let release;
    const tail = new Promise(resolve => { release = resolve; });
    addQueues.set(dir, tail);
    await previous.catch(() => {});
    try {
        return await addOwned(dir, body, info, { maxBytes, uploadedBy, uploadedById });
    } finally {
        release();
        if (addQueues.get(dir) === tail) addQueues.delete(dir);
    }
}

async function addOwned(dir, body, info, { maxBytes, uploadedBy, uploadedById } = {}) {
    const id = stickerId();
    const file = `${id}.${info.ext}`;
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `.${file}.upload`);
    let size = 0;
    const hash = crypto.createHash('sha256');
    const limit = new Transform({
        transform(chunk, encoding, done) {
            size += chunk.length;
            hash.update(chunk);
            if (maxBytes && size > maxBytes) {
                const error = new Error('The sticker is too large.');
                error.status = 413;
                return done(error);
            }
            done(null, chunk);
        }
    });
    try {
        await pipeline(body, limit, fs.createWriteStream(temp));
        if (!size) throw Object.assign(new Error('The sticker is empty.'), { status: 400 });
    } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
    }
    const signature = fs.readFileSync(temp);
    const detectedType = detectImageType(signature);
    if (!detectedType) {
        fs.rmSync(temp, { force: true });
        throw Object.assign(new Error('The file is not a supported raster image.'), { status: 400 });
    }
    if (detectedType !== info.type) {
        fs.rmSync(temp, { force: true });
        throw Object.assign(new Error('The sticker file type does not match its name.'), { status: 400 });
    }
    const digest = hash.digest('hex');
    const stickers = readManifest(dir);
    let existing = stickers.find(sticker => sticker.hash === digest && stickerFile(dir, sticker.id));
    if (!existing) {
        for (const sticker of stickers) {
            if (typeof sticker.hash === 'string') continue;
            const current = stickerFile(dir, sticker.id);
            if (current && fileHash(current.path) === digest) {
                existing = sticker;
                sticker.hash = digest;
                break;
            }
        }
    }
    if (existing) {
        fs.rmSync(temp, { force: true });
        const ownerIds = ownersOf(existing);
        if (uploadedById && !ownerIds.includes(uploadedById)) {
            existing.ownerIds = [...ownerIds, uploadedById];
            delete existing.ownerId;
            writeManifest(dir, stickers);
        }
        return { ...existing, linked: true };
    }
    fs.renameSync(temp, path.join(dir, file));
    const sticker = {
        id,
        file,
        name: info.name,
        type: info.type,
        size,
        hash: digest,
        uploadedAt: new Date().toISOString(),
        uploadedBy: uploadedBy || null,
        ownerIds: uploadedById ? [uploadedById] : [],
        source: 'upload'
    };
    writeManifest(dir, [...stickers, sticker]);
    return sticker;
}

async function addUrl(dir, url, { name, uploadedBy, uploadedById, maxBytes, sourcePageUrl } = {}) {
    if (typeof url !== 'string') return null;
    const initial = await validatePublicUrl(url);
    if (initial.error) return null;
    const parsed = initial.url;

    fs.mkdirSync(dir, { recursive: true });
    const stickers = readManifest(dir);
    const existing = stickers.find(sticker => sticker.sourceUrl === parsed.toString());
    if (existing && stickerFile(dir, existing.id)?.path) {
        const ownerIds = ownersOf(existing);
        const alreadyLinked = !!uploadedById && ownerIds.includes(uploadedById);
        if (uploadedById && !ownerIds.includes(uploadedById)) {
            existing.ownerIds = [...ownerIds, uploadedById];
            delete existing.ownerId;
        }
        if (typeof sourcePageUrl === 'string') existing.sourcePageUrl = sourcePageUrl;
        writeManifest(dir, stickers);
        return { ...existing, linked: true, alreadyLinked };
    }

    const downloadedResponse = await fetchSafe(parsed.toString(), {
        accept: 'image/gif,image/*;q=0.8,*/*;q=0.5',
        maxBytes
    });
    const bytes = downloadedResponse.body;
    const responseType = String(downloadedResponse.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    const typeByExtension = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp'
    };
    const extByType = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp'
    };
    const detectedType = detectImageType(bytes);
    const urlExt = path.extname(downloadedResponse.url.pathname).slice(1).toLowerCase();
    let type = detectedType || (extByType[responseType] ? responseType : typeByExtension[urlExt] || null);
    if (!type || !extByType[type]) {
        throw Object.assign(new Error('The sticker link is not a supported image.'), { status: 400 });
    }
    if (detectedType && detectedType !== type) {
        throw Object.assign(new Error('The sticker link is not a supported image.'), { status: 400 });
    }
    const ext = extByType[type];
    const fallbackName = name || downloadedResponse.url.pathname.split('/').filter(Boolean).pop() || 'Sticker';
    const clean = cleanName(fallbackName);
    const baseName = clean.replace(/\.(png|jpe?g|gif|webp)$/i, '') || 'Sticker';
    const info = { name: `${baseName}.${ext}`, ext, type };
    const downloaded = await add(dir, Readable.from(bytes), info, {
        maxBytes,
        uploadedBy,
        uploadedById
    });
    const updated = readManifest(dir);
    const sticker = updated.find(item => item.id === downloaded.id);
    if (sticker) {
        sticker.sourceUrl = parsed.toString();
        sticker.source = 'url';
        if (typeof sourcePageUrl === 'string') {
            sticker.sourcePageUrl = sourcePageUrl;
        } else {
            delete sticker.sourcePageUrl;
        }
        if (existing && existing.id !== sticker.id) {
            sticker.ownerIds = [...new Set([
                ...ownersOf(sticker),
                ...ownersOf(existing),
                ...(uploadedById ? [uploadedById] : [])
            ])];
            delete sticker.ownerId;
            fs.rmSync(path.join(dir, existing.file || ''), { force: true });
            writeManifest(dir, updated.filter(item => item.id !== existing.id));
        } else {
            writeManifest(dir, updated);
        }
    }
    return sticker ? { ...sticker, alreadyLinked: false, linked: !!downloaded.linked } : downloaded;
}

function fileHash(file) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } catch (error) {
        return null;
    }
}

function remove(dir, id, userId) {
    if (!STICKER_ID.test(String(id)) || typeof userId !== 'string' || !userId) return null;
    const stickers = readManifest(dir);
    const sticker = stickers.find(item => item.id === id);
    if (!sticker) return null;
    const ownerIds = ownersOf(sticker);
    if (!ownerIds.includes(userId)) return null;
    const remaining = ownerIds.filter(id => id !== userId);
    if (remaining.length) {
        sticker.ownerIds = remaining;
        delete sticker.ownerId;
        writeManifest(dir, stickers);
        return { retained: true };
    } else {
        if (sticker.source === 'upload' || sticker.source === 'url' || typeof sticker.ownerId === 'string') {
            writeManifest(dir, stickers.filter(item => item !== sticker));
            if (typeof sticker.file === 'string') fs.rmSync(path.join(dir, sticker.file), { force: true });
            return { retained: false };
        }
        sticker.ownerIds = [];
        delete sticker.ownerId;
        writeManifest(dir, stickers);
        return { retained: true };
    }
}

module.exports = {
    STICKER_ID, TYPES, cleanInfo, detectImageType, validatePublicUrl, fetchSafe,
    list, touch, link, inLibrary, stickerFile, add, addUrl, remove
};
