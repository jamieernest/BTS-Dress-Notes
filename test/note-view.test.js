const test = require('node:test');
const assert = require('node:assert');
const TimecodeFormat = require('../public/timecode-format.js');
const NoteView = require('../public/note-view.js');

function mockPopoverWindow(t, mobile = true) {
    const original = global.window;
    t.after(() => { if (original === undefined) delete global.window; else global.window = original; });
    const events = {};
    const viewportEvents = {};
    global.window = {
        innerWidth: mobile ? 390 : 1200, innerHeight: 844,
        matchMedia: () => ({ matches: mobile }),
        addEventListener: (event, callback) => { events[event] = callback; },
        visualViewport: { width: 390, height: 300, offsetTop: 50, offsetLeft: 0,
            addEventListener: (event, callback) => { viewportEvents[event] = callback; } }
    };
    return { events, viewportEvents };
}

test('mobile keyboard height changes reposition menus; rotation and desktop resize still close them', (t) => {
    const { events, viewportEvents } = mockPopoverWindow(t);
    let closes = 0;
    let repositions = 0;
    NoteView.watchPopoverResize(() => closes++, () => repositions++);
    window.innerHeight = 400;
    events.resize();
    viewportEvents.resize();
    viewportEvents.scroll();
    assert.equal(closes, 0);
    assert.equal(repositions, 3);
    window.innerWidth = 844;
    events.resize();
    assert.equal(closes, 1);
    window.matchMedia = () => ({ matches: false });
    window.innerHeight = 500;
    events.resize();
    assert.equal(closes, 2, 'desktop still closes on height-only resize');
});

test('mobile popovers stay inside the visible viewport above the keyboard', (t) => {
    mockPopoverWindow(t);
    const properties = {};
    const popover = { hidden: false, style: { setProperty: (key, value) => { properties[key] = value; } },
        getBoundingClientRect: () => ({ left: 300, top: 350, width: 200, height: 100 }) };
    NoteView.fitPopoverInViewport(popover);
    assert.equal(properties['--popover-viewport-height'], '300px');
    assert.equal(popover.style.left, '182px');
    assert.equal(popover.style.top, '242px');
    window.matchMedia = () => ({ matches: false });
    popover.style.top = '350px';
    NoteView.fitPopoverInViewport(popover);
    assert.equal(popover.style.top, '350px', 'desktop placement stays unchanged');
});

test('repositioning an open filter after a layout scroll preserves focus and its open state', (t) => {
    mockPopoverWindow(t);
    const originalDocument = global.document;
    t.after(() => { if (originalDocument === undefined) delete global.document; else global.document = originalDocument; });
    global.document = { addEventListener() {}, activeElement: null };
    const attributes = {};
    let anchorTop = 100;
    const option = { focus: () => { document.activeElement = option; } };
    const button = { setAttribute: (key, value) => { attributes[key] = value; }, addEventListener() {},
        getBoundingClientRect: () => ({ left: 12, right: 112, top: anchorTop, bottom: anchorTop + 44 }) };
    const popover = { hidden: true, offsetWidth: 200, offsetHeight: 100,
        addEventListener() {}, querySelector: () => option, contains: element => element === option,
        style: { setProperty() {} }, getBoundingClientRect() { return {
            left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: 200, height: 100
        }; } };
    const dropdown = NoteView.createDropdown({ button, popover, onChange() {} });
    dropdown.open();
    anchorTop = 70;
    dropdown.reposition();
    assert.equal(dropdown.isOpen(), true);
    assert.equal(attributes['aria-expanded'], 'true');
    assert.equal(document.activeElement, option);
    assert.equal(popover.style.top, '118px', 'the menu follows its anchor rather than closing');
});

test('timecode is HH:MM:SS:FF and the time of day HH:MM:SS.cc, everywhere', () => {
    assert.strictEqual(TimecodeFormat.formatTimecode({ hours: 1, minutes: 2, seconds: 3, frames: 4 }), '01:02:03:04');
    assert.strictEqual(TimecodeFormat.formatTimecode({ hours: 21, minutes: 5, seconds: 9, milliseconds: 456, displayMode: 'realtime' }), '21:05:09.45');
    assert.strictEqual(TimecodeFormat.formatTimecode(null), '00:00:00:00');
    assert.strictEqual(TimecodeFormat.formatDuration(65.9), '1:05');
    assert.strictEqual(TimecodeFormat.formatDuration(3725), '1:02:05');
    assert.strictEqual(TimecodeFormat.formatNoteTimecode({ frameRate: 'ms', timecode: { hours: 9, minutes: 0, seconds: 1, milliseconds: 990 } }), '09:00:01.99');
    assert.strictEqual(TimecodeFormat.formatNoteTimecode({ frameRate: 25, timecode: { hours: 9, minutes: 0, seconds: 1, frames: 24 } }), '09:00:01:24');
    assert.strictEqual(TimecodeFormat.formatNoteTimecode({ timecode: 'junk' }), '00:00:00:00');
    const now = TimecodeFormat.timeOfDay(new Date(2026, 0, 1, 7, 8, 9, 120));
    assert.strictEqual(TimecodeFormat.formatTimecode(now), '07:08:09.12');
});

test('a note, its replies and tags are drawn with every value escaped', () => {
    const tags = { lx: { id: 'lx', name: 'Lighting', color: '#E63946' }, bad: { id: 'bad', name: '<b>', color: 'red;x:url(evil)' } };
    const tagById = (id) => tags[id] || NoteView.unknownTag(id);
    const note = {
        user: '<img src=x>', userId: 'sub-1', text: 'a <script>', lxCue: '1/2"', frameRate: 30,
        timecode: { hours: 0, minutes: 1, seconds: 2, frames: 3 }, tags: ['lx', 'bad', 'gone'], comments: []
    };
    const html = NoteView.noteHTML(note, { foot: NoteView.tagChipsHTML(note.tags, tagById) });
    assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<b>'));
    assert.ok(html.includes('&lt;img src=x&gt;'));
    assert.ok(html.includes('00:01:02:03'));
    assert.ok(html.includes('--tag: #E63946'));
    assert.ok(!html.includes('evil'));
    assert.ok(html.includes('>gone</span>'), 'a deleted tag still shows, by id');
    assert.ok(!html.includes('class="comments"'), 'no replies box without replies');

    const reply = NoteView.commentHTML({ id: 'c"1', user: 'Sam', userId: 'sub-2', text: '<i>hi</i>', timestamp: Date.now() });
    assert.ok(reply.includes('data-comment-id="c&quot;1"') && reply.includes('&lt;i&gt;hi&lt;/i&gt;'));
});

test('the same person gets the same face on every page', () => {
    assert.strictEqual(NoteView.initials('Ada  Lovelace'), 'AL');
    assert.strictEqual(NoteView.initials(''), '?');
    assert.strictEqual(NoteView.personColor('sub-1'), NoteView.personColor('sub-1'));
    assert.ok(NoteView.avatarHTML('sub-1', 'Ada', 'sm').startsWith('<span class="avatar sm"'));
});

test('avatar initials use letters, skipping punctuation, numbers and emoji', () => {
    for (const [name, expected] of [
        ['Alice (Dev)', 'AD'],
        ['[Alice] {Dev}', 'AD'],
        ['Alice - (Dev) !!!', 'AD'],
        ['123 Alice 456', 'A'],
        ['🎭 Alice 🛠 Dev 🎉', 'AD'],
        ["Asher Marks-Woldman", 'AM'],
        ["Mary O’Neill", 'MO'],
        ['Élodie (Öst)', 'ÉÖ'],
        ['E\u0301lodie (O\u0308st)', 'ÉÖ'],
        ['李 小龍', '李小'],
        ['!!! 123 🎭', '?'],
        ['   ', '?'],
        [null, '?']
    ]) assert.strictEqual(NoteView.initials(name), expected, String(name));

    assert.ok(NoteView.avatarHTML('sub-alice', 'Alice (Dev)').includes('>AD</span>'));
});

test('search and filters match the same way on both notes pages', () => {
    const tagById = (id) => ({ lx: { name: 'Lighting' } }[id] || NoteView.unknownTag(id));
    const note = { text: 'Too dark', user: 'Ada', act: 'Act 2', lxCue: '45', tags: ['lx'], comments: [{ user: 'Sam', text: 'fixed' }] };
    const all = { act: 'all', tag: 'all', search: '' };
    assert.ok(NoteView.noteMatches(note, all, tagById));
    assert.ok(NoteView.noteMatches(note, { ...all, search: 'lighting' }, tagById), 'tag names are searched');
    assert.ok(NoteView.noteMatches(note, { ...all, search: 'fixed' }, tagById), 'replies are searched');
    assert.ok(!NoteView.noteMatches(note, { ...all, act: 'Act 1' }, tagById));
    assert.ok(!NoteView.noteMatches(note, { ...all, tag: 'snd' }, tagById));
    assert.ok(NoteView.noteMatches({ ...note, act: undefined }, { ...all, act: 'Preshow' }, tagById));
    assert.strictEqual(NoteView.filtersActive(all), false);
    assert.strictEqual(NoteView.filtersActive({ ...all, search: 'x' }), true);
    assert.deepStrictEqual(NoteView.tagOptions([{ id: 'lx', name: 'Lighting', color: '#fff' }])[0], { value: 'all', label: 'All tags', color: '' });
});
