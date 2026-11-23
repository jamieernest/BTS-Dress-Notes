const test = require('node:test');
const assert = require('node:assert/strict');
const GifLinks = require('../public/gifs');

test('direct GIF links and Giphy media URLs embed', () => {
    const url = 'https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExYjVtOHpvNXAzb3hkcXp1dmNkMXV2dGQ2ajB3eTZsam9qN2x3OHVwOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/1zAbIA50q9oWI725qq/giphy.gif';
    assert.equal(GifLinks.isGifUrl(url), true);
    assert.equal(GifLinks.ranges(`Look ${url}`).length, 1);
    assert.match(GifLinks.html(`Look ${url}`), /<img class="chat-gif"[^>]*src="https:\/\/media0\.giphy\.com\//);
});

test('direct Tenor media URLs embed', () => {
    const url = 'https://media.tenor.com/abc123/tenor.gif';
    assert.equal(GifLinks.isGifUrl(url), true);
    assert.equal(GifLinks.ranges(`Look ${url}`).length, 1);
    assert.match(GifLinks.html(`Look ${url}`), /<img class="chat-gif"[^>]*src="https:\/\/media\.tenor\.com\//);
});

test('Giphy page links normalize to Giphy media GIF URLs', () => {
    const page = 'https://giphy.com/gifs/funny-cat-dance-AbCd1234Ef';
    assert.equal(GifLinks.isGifUrl(page), true);
    assert.match(
        GifLinks.html(page),
        /src="https:\/\/media\.giphy\.com\/media\/AbCd1234Ef\/giphy\.gif"/
    );
});

test('provided Giphy and Tenor page links embed', () => {
    const giphy = 'https://giphy.com/gifs/dog-gFW9rRpOkMRBY2KF6s';
    assert.equal(GifLinks.isGifUrl(giphy), true);
    assert.match(GifLinks.mediaUrl(giphy), /gFW9rRpOkMRBY2KF6s\/giphy\.gif$/);
    assert.match(GifLinks.html(giphy), /src="https:\/\/media\.giphy\.com\/media\/gFW9rRpOkMRBY2KF6s\/giphy\.gif"/);

    const tenor = 'https://tenor.com/en-GB/view/love-your-freckles-day-love-your-unique-spots-love-your-freckles-natural-beauty-skin-positivity-gif-1022674371719153419';
    assert.equal(GifLinks.isGifUrl(tenor), true);
    assert.equal(GifLinks.tenorEmbedUrl(tenor), 'https://tenor.com/embed/1022674371719153419');
    assert.equal(GifLinks.mediaUrl(tenor), null);
    assert.match(GifLinks.html(tenor), /<img class="chat-gif"[^>]*src="\/gif\/resolve\?url=https%3A%2F%2Ftenor\.com%2Fen-GB%2Fview%2Flove-your-freckles-day-love-your-unique-spots-love-your-freckles-natural-beauty-skin-positivity-gif-1022674371719153419"/);
});

test('Tenor page link ranges retain the page URL and embed URL', () => {
    const tenor = 'https://tenor.com/view/happy-dance-gif-123456789';
    const ranges = GifLinks.ranges(tenor);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].url, tenor);
    assert.equal(ranges[0].embedUrl, 'https://tenor.com/embed/123456789');
    assert.equal(GifLinks.mediaUrl(tenor), null);
});

test('regional Tenor page links retain their full page URL', () => {
    const tenor = 'https://tenor.com/en-GB/view/happy-dance-gif-123456789';
    const ranges = GifLinks.ranges(tenor);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].url, tenor);
    assert.equal(ranges[0].embedUrl, 'https://tenor.com/embed/123456789');
});

test('Tenor HTML resolves an animated media GIF URL', () => {
    const html = '<meta property="og:image" content="https://media1.tenor.com/m/JZkED7HuKAkAAAAd/brandy-prank.gif">';
    assert.equal(
        GifLinks.extractTenorGifUrl(html),
        'https://media1.tenor.com/m/JZkED7HuKAkAAAAd/brandy-prank.gif'
    );
    const escaped = 'https:\\u002f\\u002fmedia.tenor.com\\u002fJZkED7HuKAkAAAAM\\u002fbrandy-prank.gif';
    assert.equal(
        GifLinks.extractTenorGifUrl(escaped),
        'https://media.tenor.com/JZkED7HuKAkAAAAM/brandy-prank.gif'
    );
});

test('Giphy embed and tracked CDN URLs remain recognized', () => {
    assert.equal(GifLinks.isGifUrl('https://giphy.com/embed/AbCd1234Ef'), true);
    assert.match(GifLinks.html('https://giphy.com/embed/AbCd1234Ef'), /\/media\/AbCd1234Ef\/giphy\.gif/);
    const tracked = 'https://media0.giphy.com/media/AbCd1234Ef/giphy.gif?cid=example&rid=example&ct=g';
    assert.equal(GifLinks.isGifUrl(tracked), true);
    assert.match(GifLinks.html(tracked), /src="https:\/\/media0\.giphy\.com\/media\/AbCd1234Ef\/giphy\.gif"/);
});

test('non-GIF URLs stay as text', () => {
    assert.equal(GifLinks.isGifUrl('https://example.com/photo.jpg'), false);
    assert.equal(GifLinks.ranges('https://example.com/photo.jpg').length, 0);
});

test('supported direct image links embed without changing GIF recognition', () => {
    assert.equal(GifLinks.isImageUrl('https://example.com/photo.png'), true);
    assert.equal(GifLinks.isImageUrl('https://example.com/photo.jpg'), true);
    assert.equal(GifLinks.isImageUrl('https://images.rawpixel.com/image_png_800/example.png'), true);
    assert.equal(GifLinks.isImageUrl('http://example.com/photo.webp'), true);
    assert.equal(GifLinks.imageRanges('Look https://example.com/photo.webp').length, 1);
    assert.match(GifLinks.html('Look https://example.com/photo.jpg'), /<img class="chat-image"/);
});

test('media-only messages are identified separately from text-with-media', () => {
    assert.equal(GifLinks.isMediaOnly('https://media.tenor.com/abc123/tenor.gif'), true);
    assert.equal(GifLinks.isMediaOnly('https://example.com/photo.jpg'), true);
    assert.equal(GifLinks.isMediaOnly('caption https://example.com/photo.jpg'), false);
});

test('GIF HTML escapes unsafe URL text', () => {
    assert.doesNotMatch(GifLinks.html('https://example.com/a.gif"><script>x</script>', []), /<script>/);
});
