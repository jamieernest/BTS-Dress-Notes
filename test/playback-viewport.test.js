const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/playback-viewport.js');

const D = 3600;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test('fit is the whole timeline', () => {
    assert.deepEqual(V.fit(D), { t0: 0, span: D });
    assert.ok(V.isFit(V.fit(D), D));
    assert.ok(!V.isFit({ t0: 0, span: 600 }, D));
    assert.deepEqual(V.fit(-5), { t0: 0, span: 0 });
});

test('clamp keeps the view inside the timeline and no closer than the minimum', () => {
    assert.deepEqual(V.clamp({ t0: -50, span: 600 }, D), { t0: 0, span: 600 });
    assert.deepEqual(V.clamp({ t0: 3500, span: 600 }, D), { t0: 3000, span: 600 });
    assert.deepEqual(V.clamp({ t0: 10, span: 2 }, D), { t0: 10, span: V.MIN_SPAN });
    assert.deepEqual(V.clamp({ t0: 10, span: D * 3 }, D), { t0: 0, span: D });
    assert.deepEqual(V.clamp({ t0: NaN, span: NaN }, D), V.fit(D));
    assert.deepEqual(V.clamp({ t0: 0, span: 5 }, 8), V.fit(8), 'a timeline shorter than the minimum cannot be zoomed');
    assert.deepEqual(V.clamp({ t0: 3, span: 100 }, 0), V.fit(0));
});

test('zooming keeps the time under the anchor where it was', () => {
    const view = { t0: 600, span: 1200 };
    const next = V.zoomAt(view, 0.25, 2, D);
    close(next.span, 600);
    close(next.t0 + 0.25 * next.span, view.t0 + 0.25 * view.span);
    const out = V.zoomAt(next, 0.25, 0.5, D);
    close(out.t0, view.t0);
    close(out.span, view.span);
});

test('zooming in from fit and back out lands on fit', () => {
    let view = V.zoomAt(V.fit(D), 0.7, 4, D);
    assert.equal(view.span, D / 4);
    view = V.zoomAt(view, 0.7, 0.25, D);
    assert.deepEqual(view, V.fit(D));
    assert.deepEqual(V.zoomAt(V.fit(D), 0.5, 0.5, D), V.fit(D), 'cannot zoom out past the whole show');
});

test('zooming in stops at the minimum span', () => {
    let view = V.fit(D);
    for (let i = 0; i < 20; i++) view = V.zoomAt(view, 0.5, 2, D);
    assert.equal(view.span, V.MIN_SPAN);
    assert.ok(view.t0 >= 0 && view.t0 + view.span <= D);
});

test('an anchor near the edge cannot push the view off the timeline', () => {
    const view = V.zoomAt(V.fit(D), 0, 8, D);
    assert.deepEqual(view, { t0: 0, span: D / 8 });
    const end = V.zoomAt(V.fit(D), 1, 8, D);
    close(end.t0 + end.span, D);
});

test('panning stops at both ends', () => {
    const view = { t0: 1000, span: 600 };
    assert.deepEqual(V.panBy(view, 200, D), { t0: 1200, span: 600 });
    assert.deepEqual(V.panBy(view, -5000, D), { t0: 0, span: 600 });
    assert.deepEqual(V.panBy(view, 9000, D), { t0: D - 600, span: 600 });
    assert.deepEqual(V.panBy(V.fit(D), 100, D), V.fit(D));
});

test('fitRange shows a stretch with a margin', () => {
    const view = V.fitRange(1000, 1200, D);
    close(view.span, 220);
    close(view.t0, 990);
    assert.deepEqual(V.fitRange(0, 100, D, 0.1).t0, 0, 'pushed inside at the start');
    assert.deepEqual(V.fitRange(0, D, D), V.fit(D));
    assert.equal(V.fitRange(500, 502, D).span, V.MIN_SPAN, 'a very short stretch still gets the minimum');
});

test('follow turns the page when the playhead nears the right edge or leaves the view', () => {
    const view = { t0: 1000, span: 1000 };
    assert.equal(V.follow(view, 1500, D, true), view);
    assert.equal(V.follow(view, 1899, D, true), view);
    const flipped = V.follow(view, 1950, D, true);
    close(flipped.t0, 1950 - 100);
    assert.equal(flipped.span, 1000);
    assert.equal(V.follow(view, 1950, D, false), view, 'a still playhead can sit near the edge');
    const back = V.follow(view, 400, D, false);
    close(back.t0, 300);
    assert.equal(V.follow(V.fit(D), 1950, D, true).span, D);
});

test('follow stays inside the timeline', () => {
    const end = V.follow({ t0: 2000, span: 1000 }, 3550, D, true);
    assert.deepEqual(end, { t0: 2600, span: 1000 });
    const start = V.follow({ t0: 2000, span: 1000 }, 20, D, false);
    assert.deepEqual(start, { t0: 0, span: 1000 });
});

test('reveal centres a playhead that is out of view and leaves one in view alone', () => {
    const view = { t0: 1000, span: 600 };
    assert.equal(V.reveal(view, 1100, D), view);
    assert.deepEqual(V.reveal(view, 2000, D), { t0: 1700, span: 600 });
});

test('ticks are round numbers at least the minimum gap apart', () => {
    const wide = V.ticks({ t0: 0, span: 600 }, 1000);
    assert.deepEqual(wide, [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
    const shifted = V.ticks({ t0: 1234, span: 100 }, 1000);
    assert.deepEqual(shifted, [1240, 1250, 1260, 1270, 1280, 1290, 1300, 1310, 1320, 1330]);
    assert.ok(shifted.every(t => t >= 1234 && t <= 1334));
    for (const span of [15, 100, 900, 3600, 10800]) {
        for (const width of [300, 1000, 1600]) {
            const list = V.ticks({ t0: 0, span }, width);
            if (list.length > 1) assert.ok((list[1] - list[0]) * width / span >= 80, `${span}s over ${width}px`);
        }
    }
    assert.deepEqual(V.ticks({ t0: 0, span: 0 }, 1000), []);
    assert.deepEqual(V.ticks({ t0: 0, span: 600 }, 0), []);
});
