const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/chat-resize');

function fixture({ viewport = 1280, saved = null, blocked = false } = {}) {
    const events = () => ({ callbacks: new Map(),
        addEventListener(name, callback) { this.callbacks.set(name, callback); },
        removeEventListener(name) { this.callbacks.delete(name); },
        fire(name, extra = {}) {
            const event = { preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
            this.callbacks.get(name)?.(event); return event;
        } });
    const win = { ...events(), innerWidth: viewport };
    const attributes = {};
    const separator = { ...events(),
        setAttribute(name, value) { attributes[name] = value; },
        setPointerCapture(id) { this.captured = id; },
        hasPointerCapture(id) { return this.captured === id; },
        releasePointerCapture() { this.captured = null; }
    };
    const classes = new Set();
    const root = { style: { setProperty(name, value) { this[name] = value; } },
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
    const drawer = { hidden: false };
    let stored = saved, changes = 0, starts = 0;
    const storage = { getItem() { if (blocked) throw Error('blocked'); return stored; },
        setItem(name, value) { if (blocked) throw Error('blocked'); stored = value; } };
    const controller = R.createChatResize({ separator, drawer, root, win, storage,
        onChange: () => changes++, onStart: () => starts++ });
    return { win, separator, root, drawer, attributes, classes, controller,
        width: () => Number(attributes['aria-valuenow']), saved: () => stored,
        changes: () => changes, starts: () => starts };
}

test('saved width is bounded and malformed/unavailable storage uses the default', () => {
    for (const raw of [null, '', 'auto', 'NaN', 'Infinity', -1, {}, undefined]) assert.equal(R.preferredWidth(raw), 420);
    assert.equal(R.preferredWidth('10000'), 800);
    assert.equal(R.preferredWidth('200'), 320);
    assert.equal(R.preferredWidth('563.8'), 564);
    assert.equal(fixture({ blocked: true }).width(), 420);
});

test('pointer drag changes width live, clamps both ends and persists only on release', () => {
    const f = fixture();
    f.separator.fire('pointerdown', { button: 0, isPrimary: true, pointerId: 7, clientX: 860 });
    assert.ok(f.classes.has('chat-resizing'));
    assert.equal(f.starts(), 1);
    f.separator.fire('pointermove', { pointerId: 8, clientX: 600 }); // Another pointer has no effect.
    assert.equal(f.width(), 420);
    f.separator.fire('pointermove', { pointerId: 7, clientX: 640 });
    assert.equal(f.width(), 640);
    assert.equal(f.saved(), null);
    f.separator.fire('pointermove', { pointerId: 7, clientX: -100 });
    assert.equal(f.width(), 800);
    f.separator.fire('pointermove', { pointerId: 7, clientX: 1500 });
    assert.equal(f.width(), 320);
    f.separator.fire('pointerup', { pointerId: 7 });
    assert.equal(f.saved(), '320');
    assert.ok(!f.classes.has('chat-resizing'));
    assert.equal(f.separator.captured, null);
});

test('viewport clamps preserve preference and mobile separator cannot resize or receive focus', () => {
    const f = fixture({ saved: '800' });
    f.win.innerWidth = 1000; f.win.fire('resize');
    assert.equal(f.width(), 520);
    assert.equal(f.saved(), '800');
    f.win.innerWidth = 390; f.win.fire('resize');
    assert.equal(f.separator.tabIndex, -1);
    assert.equal(f.attributes['aria-disabled'], 'true');
    f.separator.fire('pointerdown', { button: 0, pointerId: 1, clientX: 200 });
    assert.ok(!f.classes.has('chat-resizing'));
    f.win.innerWidth = 1440; f.win.fire('resize');
    assert.equal(f.width(), 800);
    assert.equal(f.separator.tabIndex, 0);
    assert.equal(f.attributes['aria-valuemin'], '320');
    assert.equal(f.attributes['aria-valuemax'], '800');
    f.win.document = { documentElement: { clientWidth: 980 } };
    f.win.innerWidth = 1000; f.win.fire('resize');
    assert.equal(f.width(), 500, 'a non-overlay scrollbar also leaves 480px for notes');
});

test('cancellation, lost capture, blur and closing the panel restore preference without stuck dragging', () => {
    for (const action of ['pointercancel', 'lostpointercapture', 'blur', 'Escape', 'close']) {
        const f = fixture({ saved: '600' });
        f.separator.fire('pointerdown', { button: 0, pointerId: 1, clientX: 680 });
        f.separator.fire('pointermove', { pointerId: 1, clientX: 500 });
        assert.equal(f.width(), 780);
        if (action === 'blur') f.win.fire('blur');
        else if (action === 'Escape') f.win.fire('keydown', { key: 'Escape' });
        else if (action === 'close') { f.drawer.hidden = true; f.controller.refresh(); }
        else f.separator.fire(action, { pointerId: 1 });
        assert.equal(f.width(), 600, action);
        assert.equal(f.saved(), '600', action);
        assert.ok(!f.classes.has('chat-resizing'), action);
    }
});

test('keyboard resizing is local to the separator, preserves typing arrows and respects modifiers', () => {
    const f = fixture();
    f.win.fire('keydown', { key: 'ArrowLeft' });
    assert.equal(f.width(), 420, 'an arrow in another field must keep editing text');
    f.separator.fire('keydown', { key: 'ArrowLeft' });
    assert.equal(f.width(), 436);
    f.separator.fire('keydown', { key: 'ArrowRight', shiftKey: true });
    assert.equal(f.width(), 372);
    f.separator.fire('keydown', { key: 'End' });
    assert.equal(f.width(), 800);
    f.separator.fire('keydown', { key: 'Home' });
    assert.equal(f.width(), 320);
    for (const modifier of ['isComposing', 'ctrlKey', 'altKey', 'metaKey']) {
        f.separator.fire('keydown', { key: 'ArrowLeft', [modifier]: true });
        assert.equal(f.width(), 320, modifier);
    }
    assert.equal(f.saved(), '320');
    assert.equal(f.attributes['aria-valuetext'], '320 pixels wide');
});

test('cross-tab updates work without write loops; blocked storage and teardown stay usable', () => {
    const f = fixture({ blocked: true });
    f.separator.fire('keydown', { key: 'ArrowLeft' });
    assert.equal(f.width(), 436);
    f.win.fire('storage', { key: R.KEY, newValue: '600' });
    assert.equal(f.width(), 600);
    f.controller.destroy();
    assert.equal(f.separator.callbacks.size, 0);
    assert.equal(f.win.callbacks.size, 0);
});
