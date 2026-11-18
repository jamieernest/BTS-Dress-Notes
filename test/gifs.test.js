const test = require('node:test');
const assert = require('node:assert/strict');
const GifLinks = require('../public/gifs');

test('direct GIF links and Giphy media URLs embed', () => {
    const url = 'https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExYjVtOHpvNXAzb3hkcXp1dmNkMXV2dGQ2ajB3eTZsam9qN2x3OHVwOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/1zAbIA50q9oWI725qq/giphy.gif';
    assert.equal(GifLinks.isGifUrl(url), true);
    assert.equal(GifLinks.ranges(`Look ${url}`).length, 1);
    assert.match(GifLinks.html(`Look ${url}`), /<img class="chat-gif"[^>]*src="https:\/\/media0\.giphy\.com\//);
});

test('Giphy page links normalize to Giphy media GIF URLs', () => {
    const page = 'https://giphy.com/gifs/funny-cat-dance-AbCd1234Ef';
    assert.equal(GifLinks.isGifUrl(page), true);
    assert.match(
        GifLinks.html(page),
        /src="https:\/\/media\.giphy\.com\/media\/AbCd1234Ef\/giphy\.gif"/
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

test('GIF HTML escapes unsafe URL text', () => {
    assert.doesNotMatch(GifLinks.html('https://example.com/a.gif"><script>x</script>', []), /<script>/);
});
