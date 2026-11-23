const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const stickers = require('../stickers');

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const GIF = Buffer.from([71, 73, 70, 56, 57, 97, 0, 1, 0, 1]);
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
const WEBP = Buffer.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);

test('sticker controls explain entry methods, library actions and supported uploads', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8');
    assert.match(html, /title="Add stickers with Giphy, Tenor, upload or copy\/paste"/);
    assert.match(html, /title="Supports PNG, JPEG, GIF and WebP files"/);
    assert.match(js, /Add it to my sticker library/);
});

test('syncing sticker library state updates chat actions without rebuilding chat messages', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8');
    const syncStart = js.indexOf('function syncStickerLibrary');
    const syncEnd = js.indexOf('function renderStickers', syncStart);
    assert.ok(syncStart >= 0 && syncEnd > syncStart);
    const sync = js.slice(syncStart, syncEnd);
    assert.doesNotMatch(sync, /updateChatMessages\(\)/);
    assert.match(sync, /chatMessages\.querySelectorAll\('\[data-add-sticker\]'\)/);
    assert.match(sync, /chatMessages\.querySelectorAll\('\[data-add-gif\]'\)/);
});

test('sticker info accepts raster formats and rejects SVG', () => {
    assert.deepEqual(stickers.cleanInfo('happy.png', 'image/png'), {
        name: 'happy.png', ext: 'png', type: 'image/png'
    });
    assert.equal(stickers.cleanInfo('happy.svg', 'image/svg+xml').error ? true : false, true);
});

test('image signatures determine supported raster formats', () => {
    assert.equal(stickers.detectImageType(PNG), 'image/png');
    assert.equal(stickers.detectImageType(JPEG), 'image/jpeg');
    assert.equal(stickers.detectImageType(GIF), 'image/gif');
    assert.equal(stickers.detectImageType(WEBP), 'image/webp');
    assert.equal(stickers.detectImageType(Buffer.from('<svg></svg>')), null);
});

test('private and loopback URLs are rejected without fetching', async () => {
    for (const url of [
        'http://127.0.0.1/a.gif',
        'http://10.0.0.1/a.gif',
        'http://[::1]/a.gif',
        'http://localhost/a.gif'
    ]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sticker-private-'));
        assert.equal(await stickers.addUrl(dir, url, { maxBytes: 1024 }), null);
    }
});

test('manifest entries require a matching known MIME type and filename', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sticker-manifest-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stickers.json'), JSON.stringify({ stickers: [
        {
            id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            file: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
            name: 'good.png',
            type: 'image/png'
        },
        {
            id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            file: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.gif',
            name: 'wrong.gif',
            type: 'text/html'
        },
        {
            id: 'cccccccccccccccccccccccccccccccc',
            file: 'not-the-id.png',
            name: 'wrong-name.png',
            type: 'image/png'
        }
    ] }));
    assert.equal(stickers.list(dir, 'user-a').length, 0);
    assert.equal(stickers.stickerFile(dir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null);
    assert.equal(stickers.stickerFile(dir, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), null);
    assert.equal(stickers.stickerFile(dir, 'cccccccccccccccccccccccccccccccc'), null);
});

test('uploads reject bytes that do not match the declared raster format', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sticker-signature-'));
    await assert.rejects(
        stickers.add(dir, Readable.from([Buffer.from('<svg></svg>')]),
            { name: 'fake.png', ext: 'png', type: 'image/png' },
            { uploadedById: 'user-a', maxBytes: 1024 }),
        error => error.status === 400
    );
});

test('safe fetch rejects excessive redirects', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/next.gif' }
    });
    try {
        await assert.rejects(
            stickers.fetchSafe('https://example.com/a.gif', { maxRedirects: 2 }),
            error => error.status === 502
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('adds, lists, serves and removes a sticker', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-stickers-'));
    const added = await stickers.add(dir, Readable.from([PNG]),
        { name: 'smile.png', ext: 'png', type: 'image/png' },
        { maxBytes: 5 * 1024 ** 2, uploadedBy: 'tester', uploadedById: 'user-a' });

    assert.equal(stickers.list(dir, 'user-a').length, 1);
    assert.equal(stickers.list(dir, 'user-a')[0].id, added.id);
    assert.equal(stickers.list(dir, 'user-b').length, 0);
    assert.equal(stickers.stickerFile(dir, added.id).type, 'image/png');
    assert.equal(stickers.remove(dir, added.id, 'user-b'), null);
    assert.equal(stickers.remove(dir, added.id, 'user-a').retained, false);
    assert.equal(stickers.list(dir, 'user-a').length, 0);
});

test('recently used stickers sort first and touching is persistent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-stickers-'));
    const old = await stickers.add(dir, Readable.from([PNG]),
        { name: 'old.png', ext: 'png', type: 'image/png' },
        { uploadedById: 'user-a' });
    const recent = await stickers.add(dir, Readable.from([PNG]),
        { name: 'recent.png', ext: 'png', type: 'image/png' },
        { uploadedById: 'user-a' });

    assert.equal(stickers.touch(dir, old.id, 'user-a').id, old.id);
    assert.equal(stickers.list(dir, 'user-a')[0].id, old.id);
    assert.equal(stickers.touch(dir, old.id, 'user-b'), null);
    assert.equal(stickers.list(dir, 'user-b').length, 0);

    stickers.touch(dir, recent.id, 'user-a');
    assert.equal(stickers.list(dir, 'user-a')[0].id, recent.id);
});

test('manual stickers can be linked to a user and uploads dedupe by hash', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-stickers-'));
    const bytes = Buffer.concat([PNG, Buffer.from([1, 2, 3])]);
    const first = await stickers.add(dir, Readable.from([bytes]),
        { name: 'manual.png', ext: 'png', type: 'image/png' },
        { uploadedById: 'user-a' });
    assert.equal(first.ownerIds.includes('user-a'), true);

    const duplicate = await stickers.add(dir, Readable.from([bytes]),
        { name: 'copy.png', ext: 'png', type: 'image/png' },
        { uploadedById: 'user-b' });
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.linked, true);
    assert.equal(stickers.list(dir, 'user-a').length, 1);
    assert.equal(stickers.list(dir, 'user-b').length, 1);
});

test('removing a shared sticker only unlinks the current owner', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-stickers-'));
    const bytes = Buffer.concat([PNG, Buffer.from([9, 8, 7])]);
    const first = await stickers.add(dir, Readable.from([bytes]),
        { name: 'shared.png', ext: 'png', type: 'image/png' },
        { uploadedById: 'user-a' });
    await stickers.add(dir, Readable.from([bytes]),
        { name: 'same.png', ext: 'png', type: 'image/png' },
        { uploadedById: 'user-b' });

    assert.equal(stickers.remove(dir, first.id, 'user-a').retained, true);
    assert.equal(stickers.list(dir, 'user-a').length, 0);
    assert.equal(stickers.list(dir, 'user-b').length, 1);
    assert.equal(stickers.stickerFile(dir, first.id) !== null, true);
});

test('a sticker in the manifest can be linked without copying its file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-stickers-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stickers.json'), JSON.stringify({ stickers: [{
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        file: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
        name: 'seeded.png',
        type: 'image/png',
        size: 1
    }] }));
    fs.writeFileSync(path.join(dir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), PNG);

    assert.equal(stickers.inLibrary(dir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'user-a'), false);
    assert.equal(stickers.link(dir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'user-a').ownerIds.includes('user-a'), true);
    assert.equal(stickers.inLibrary(dir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'user-a'), true);
});

test('a manifest entry with no file cannot be linked', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-stickers-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stickers.json'), JSON.stringify({ stickers: [{
        id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        file: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
        name: 'missing.png',
        type: 'image/png',
        size: 1
    }] }));

    assert.equal(stickers.link(dir, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'user-a'), null);
});

test('a manifest entry with no file is not reused as an upload duplicate', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-stickers-'));
    fs.mkdirSync(dir, { recursive: true });
    const bytes = PNG;
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(dir, 'stickers.json'), JSON.stringify({ stickers: [{
        id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        file: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
        name: 'missing.png',
        type: 'image/png',
        size: bytes.length,
        hash
    }] }));

    const added = await stickers.add(dir, Readable.from([bytes]),
        { name: 'replacement.png', ext: 'png', type: 'image/png' },
        { uploadedById: 'user-a' });

    assert.notEqual(added.id, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    assert.equal(stickers.stickerFile(dir, added.id) !== null, true);
});

test('shared sticker URLs render as sticker media', () => {
    const publicStickers = require('../public/stickers');
    const url = '/stickers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    assert.equal(publicStickers.stickerUrl(url), url);
    assert.equal(publicStickers.html(url).includes(url), true);
    assert.equal(publicStickers.html('Reply text'), '');
});

test('GIF URL stickers are downloaded, stored locally, and deduplicated', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sticker-url-'));
    const url = 'https://media.giphy.com/media/AbCd1234Ef/giphy.gif';
    const bytes = GIF;
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/gif', 'content-length': String(bytes.length) }
    });
    try {
        const added = await stickers.addUrl(dir, url, {
            uploadedBy: 'tester', uploadedById: 'user-a', maxBytes: 5 * 1024 ** 2
        });
        assert.equal(added.ownerIds.includes('user-a'), true);
        assert.equal(stickers.list(dir, 'user-a')[0].id, added.id);
        assert.equal(stickers.stickerFile(dir, added.id).type, 'image/gif');
        assert.equal(stickers.stickerFile(dir, added.id).path.endsWith('.gif'), true);
        assert.equal(stickers.stickerFile(dir, added.id).redirect, undefined);

        const duplicate = await stickers.addUrl(dir, url, {
            uploadedById: 'user-b', maxBytes: 5 * 1024 ** 2
        });
        assert.equal(duplicate.id, added.id);
        assert.equal(duplicate.linked, true);
        assert.equal(stickers.list(dir, 'user-b').length, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test('PNG, JPEG and WebP URL stickers keep their raster format', async () => {
    const cases = [
        ['photo.png', 'image/png', 'png', PNG],
        ['photo.jpg', 'image/jpeg', 'jpg', JPEG],
        ['photo.webp', 'image/webp', 'webp', WEBP]
    ];
    for (const [filename, contentType, ext, bytes] of cases) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bts-sticker-url-${ext}-`));
        const url = `https://example.com/${filename}`;
        const originalFetch = global.fetch;
        global.fetch = async () => new Response(bytes, {
            status: 200,
            headers: { 'content-type': contentType }
        });
        try {
            const added = await stickers.addUrl(dir, url, {
                uploadedById: 'user-a',
                maxBytes: 5 * 1024 ** 2
            });
            assert.equal(stickers.stickerFile(dir, added.id).type, contentType);
            assert.equal(stickers.stickerFile(dir, added.id).path.endsWith(`.${ext}`), true);
        } finally {
            global.fetch = originalFetch;
        }
    }
});

test('adding the same GIF URL again returns alreadyLinked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sticker-url-existing-'));
    const url = 'https://media.giphy.com/media/AbCd1234Ef/giphy.gif';
    const bytes = GIF;
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(bytes, { status: 200 });
    try {
        await stickers.addUrl(dir, url, { uploadedById: 'user-a', maxBytes: 5 * 1024 ** 2 });
        const again = await stickers.addUrl(dir, url, { uploadedById: 'user-a', maxBytes: 5 * 1024 ** 2 });
        assert.equal(again.alreadyLinked, true);
    } finally {
        global.fetch = originalFetch;
    }
});

test('Tenor page source is stored and reused for library state', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sticker-tenor-'));
    const url = 'https://media.tenor.com/example/tenor.gif';
    const pageUrl = 'https://tenor.com/view/example-gif-123456789';
    const bytes = GIF;
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(bytes, { status: 200 });
    try {
        const added = await stickers.addUrl(dir, url, {
            uploadedById: 'user-a',
            sourcePageUrl: pageUrl,
            maxBytes: 5 * 1024 ** 2
        });
        const listed = stickers.list(dir, 'user-a')[0];
        assert.equal(listed.sourceUrl, url);
        assert.equal(listed.sourcePageUrl, pageUrl);
    } finally {
        global.fetch = originalFetch;
    }
});
