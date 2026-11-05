const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoadingState } = require('../public/loading-state');

function loading() {
    let clock = 0;
    let nextId = 0;
    const tasks = new Map();
    const classes = new Set();
    const attrs = new Map();
    const element = {
        classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)) },
        setAttribute: (key, value) => attrs.set(key, value)
    };
    const state = createLoadingState(element, {
        now: () => clock,
        schedule: (fn, delay) => { const id = ++nextId; tasks.set(id, { at: clock + delay, fn }); return id; },
        cancel: id => tasks.delete(id)
    });
    function advance(ms) {
        const end = clock + ms;
        while (true) {
            const next = [...tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            tasks.delete(next[0]);
            clock = next[1].at;
            next[1].fn();
        }
        clock = end;
    }
    return { state, classes, attrs, advance, tasks };
}

test('a fast load reveals content without ever showing a skeleton', async () => {
    const l = loading();
    assert.equal(l.attrs.get('aria-busy'), 'true');
    l.advance(150);
    await l.state.finish();
    l.advance(1000);
    assert.equal(l.classes.has('show-loading'), false);
    assert.equal(l.classes.has('is-loading'), false);
    assert.equal(l.attrs.get('aria-busy'), 'false');
    assert.equal(l.tasks.size, 0);
});

test('a slow load shows skeletons after 400 ms and avoids a short flash', async () => {
    const l = loading();
    l.advance(399);
    assert.equal(l.classes.has('show-loading'), false);
    l.advance(1);
    assert.equal(l.classes.has('show-loading'), true);
    l.advance(20);
    let revealed = false;
    const done = l.state.finish().then(() => { revealed = true; });
    l.advance(279);
    await Promise.resolve();
    assert.equal(revealed, false);
    assert.equal(l.classes.has('is-loading'), true);
    l.advance(1);
    await done;
    assert.equal(l.classes.has('is-loading'), false);
});

test('content arriving after the minimum stay has no extra delay', async () => {
    const l = loading();
    l.advance(1200);
    await l.state.finish();
    assert.equal(l.classes.has('is-loading'), false);
    assert.equal(l.tasks.size, 0);
});

test('cached content and local actions bypass a visible skeleton and pending reveal', async () => {
    const l = loading();
    l.advance(450);
    const first = l.state.finish();
    await l.state.finish({ immediate: true });
    await first;
    l.advance(1000);
    assert.equal(l.classes.has('is-loading'), false);
    assert.equal(l.classes.has('show-loading'), false);
    assert.equal(l.tasks.size, 0);
});
