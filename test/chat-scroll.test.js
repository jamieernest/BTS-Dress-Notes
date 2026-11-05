const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatScroll } = require('../public/chat-scroll');

function fixture() {
    let frame;
    let resized;
    const scroller = {
        clientWidth: 539, clientHeight: 600, scrollHeight: 1200, scrollTop: 600,
        addEventListener(type, cb) { this.scroll = cb; },
        getBoundingClientRect: () => ({ top: 0 })
    };
    let top = scroller.scrollTop;
    Object.defineProperty(scroller, 'scrollTop', {
        get: () => top,
        set(value) { top = Math.max(0, Math.min(value, scroller.scrollHeight - scroller.clientHeight)); }
    });
    const content = { children: [] };
    function row(id, top, height = 100) {
        const r = { dataset: { chatId: id }, parentNode: content, top,
            getBoundingClientRect() { return { top: this.top - scroller.scrollTop, height }; } };
        content.children.push(r);
        return r;
    }
    row('older', 200); row('latest', 600, 600);
    const controller = createChatScroll(scroller, content, {
        schedule(cb) { frame = cb; },
        observe(cb) { resized = cb; return { observe() {} }; }
    });
    return { scroller, content, controller, row, resize: () => resized(),
        flush() { if (frame) { const cb = frame; frame = null; cb(); } } };
}

test('pre-layout bottom survives wrapping, viewport shrink and a scroll event before resize notification', () => {
    const f = fixture();
    f.scroller.clientWidth = 390;
    f.scroller.clientHeight = 450;
    f.scroller.scrollHeight = 1600;
    f.scroller.scroll(); // Already reflowed; measuring here would report a 550px gap.
    f.resize(); f.flush();
    assert.equal(f.scroller.scrollTop, 1150);
    assert.equal(f.controller.followsBottom(), true);
    f.scroller.scrollHeight = 1900; // A later asynchronous render must also follow.
    f.resize(); f.flush();
    assert.equal(f.scroller.scrollTop, 1450);
});

test('deliberate scroll back preserves the visible message offset through rewrap', () => {
    const f = fixture();
    f.scroller.scrollTop = 225; f.scroller.scroll();
    assert.equal(f.controller.followsBottom(), false);
    f.content.children[0].top = 280;
    f.scroller.clientWidth = 390; f.scroller.scrollHeight = 1800;
    f.scroller.scroll(); f.resize(); f.flush();
    assert.equal(f.scroller.scrollTop, 305); // Same older row, still 25px above the viewport.
    assert.equal(f.controller.followsBottom(), false);
});

test('bottom boundary tolerates rounding, but preserves a deliberate small gap', () => {
    for (const [gap, expected] of [[-0.5, true], [0, true], [2, true], [2.1, false], [79, false]]) {
        const f = fixture();
        f.scroller.scrollTop = 600 - gap; f.scroller.scroll();
        assert.equal(f.controller.followsBottom(), expected, `gap ${gap}`);
    }
});

test('composer expansion, removal and hidden layouts keep the previous reading intent', () => {
    const f = fixture();
    f.scroller.scrollTop = 225; f.scroller.scroll();
    f.scroller.clientHeight = 0; f.scroller.scroll(); f.resize(); f.flush();
    f.scroller.clientHeight = 450; f.resize(); f.flush();
    assert.equal(f.scroller.scrollTop, 225);
    f.scroller.clientHeight = 600; f.resize(); f.flush();
    assert.equal(f.scroller.scrollTop, 225);
    f.controller.follow();
    assert.equal(f.scroller.scrollTop, 600);
    f.scroller.clientHeight = 450; f.resize(); f.flush();
    assert.equal(f.controller.followsBottom(), true);
});

test('full log refresh preserves the visible message by stable id', () => {
    const f = fixture();
    f.scroller.scrollTop = 225; f.scroller.scroll();
    f.content.children[0].parentNode = null;
    f.content.children = [];
    f.row('older', 300);
    f.controller.layoutChanged(); f.flush();
    assert.equal(f.scroller.scrollTop, 325);
});
