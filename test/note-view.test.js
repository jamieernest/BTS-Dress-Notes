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
    assert.ok(!html.includes('note-tc') && !html.includes('00:01:02:03'), 'precise timing remains in the data, not the note header');
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
    const profileAvatar = NoteView.avatarHTML('sub-1', 'Ewan', '', 'ejws20');
    assert.ok(profileAvatar.includes('https://www.bts-crew.com/images/profiles/ejws20.jpg'));
    assert.ok(profileAvatar.includes('class="avatar-initials">E</span>'));
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

    assert.ok(NoteView.avatarHTML('sub-alice', 'Alice (Dev)', null).includes('>AD</span></span>'));
    assert.ok(!NoteView.avatarHTML('sub-alice', 'Alice (Dev)', '', 'bad prefix!').includes('bts-crew.com'));
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

test('author filtering uses exact stable accounts, composed with every other filter', () => {
    const note = { userId: 'sub-alex', user: 'Alex', text: 'Sound entrance', act: 'Act 2', tags: ['snd'], comments: [] };
    const filters = { author: 'sub-alex', act: 'Act 2', tag: 'snd', search: 'entrance' };
    assert.ok(NoteView.noteMatches(note, filters, NoteView.unknownTag));
    for (const change of [{ userId: 'sub-other' }, { userId: undefined }, { act: 'Act 1' }, { tags: ['lx'] }, { text: 'Exit' }]) {
        assert.equal(NoteView.noteMatches({ ...note, ...change }, filters, NoteView.unknownTag), false);
    }
    assert.equal(NoteView.filtersActive({ act: 'all', tag: 'all', search: '', author: 'sub-alex' }), true);
});

test('offline authors deduplicate by identity, keep name aliases and distinguish namesakes', () => {
    const authors = NoteView.authorOptions([
        { userId: 'one', user: 'Old Alex' }, { userId: 'one', user: 'Alex' },
        { userId: 'two', user: 'Alex' }, { user: 'Alex' }, { userId: '', user: 'Alex' }
    ]);
    assert.equal(authors.length, 2);
    assert.equal(authors[0].label, 'Alex · Account 1');
    assert.deepEqual(authors[0].names, ['Old Alex', 'Alex']);
    assert.equal(authors[1].label, 'Alex · Account 2');
    assert.equal(NoteView.storedAuthorId({ userId: 'old-socket' }), undefined);
    assert.equal(NoteView.storedAuthorId({ userId: 'old-socket' }, [{ userId: 'one' }]), undefined);
    assert.equal(NoteView.storedAuthorId({ userId: 'one' }, [{ userId: 'one' }]), 'one');
});

test('filter URL round trips preserve other parameters and opaque author IDs', () => {
    const params = new URLSearchParams('show=rehearsal&note=n1');
    const filters = { act: 'Act 2', tag: 'snd', search: 'sound', author: 'sub/a & b', mentionedUserId: 'sub-mention' };
    NoteView.writeFilters(params, filters, 'Sound');
    assert.deepEqual(NoteView.readFilters(new URLSearchParams(params.toString())), filters);
    assert.equal(params.get('show'), 'rehearsal');
    assert.equal(params.get('note'), 'n1');
    NoteView.writeFilters(params, { act: 'all', tag: 'all', author: '' }, '');
    assert.equal(params.toString(), 'show=rehearsal&note=n1');
});

test('author and mentioned-account filters distinguish senders from recipients and compose', () => {
    const note = { userId: 'sub-alice', user: 'Alice', text: '@Bob check this',
        tags: [], act: 'Act 1', mentions: [{ userId: 'sub-bob', name: 'Bob', start: 0, end: 4 }], comments: [] };
    const any = { act: 'all', tag: 'all', search: '', author: '', mentionedUserId: '' };
    assert.equal(NoteView.noteMatches(note, { ...any, author: 'sub-alice', mentionedUserId: 'sub-bob' }, () => ({})), true);
    assert.equal(NoteView.noteMatches(note, { ...any, author: 'sub-bob' }, () => ({})), false);
    assert.equal(NoteView.noteMatches(note, { ...any, mentionedUserId: 'sub-alice' }, () => ({})), false);
    note.comments.push({ text: '@Alice reply', mentions: [{ userId: 'sub-alice', name: 'Alice', start: 0, end: 6 }] });
    assert.equal(NoteView.noteMatches(note, { ...any, mentionedUserId: 'sub-alice' }, () => ({})), true);
    assert.equal(NoteView.filtersActive({ ...any, mentionedUserId: 'sub-bob' }), true);
});


test('note headers show name, cue and reference in order without a per-note clock', () => {
    const header = NoteView.noteHeadHTML({ noteNumber: 49, lxCue: '12', timestamp: '2026-11-05T12:34:56Z',
        timecode: { hours: 1, minutes: 2, seconds: 3, frames: 4 } }, 'Alice', '<span class="row-actions">Actions</span>');
    assert.ok(header.indexOf('>Alice</span>') < header.indexOf('Cue 12'));
    assert.ok(header.indexOf('Cue 12') < header.indexOf('>#49</span>'));
    assert.ok(!header.includes('note-tc') && !header.includes('01:02:03:04'));
});

test('scene clocks use the first logged entry, then the oldest valid retained note, independent of order', () => {
    const notes = [
        { act: 'Preshow', timestamp: '2026-11-05T20:49:00Z' },
        { act: 'Preshow', timestamp: '2026-11-05T19:49:00Z' },
        { act: 'Act One', timestamp: '2026-11-05T21:00:00Z' },
        { act: 'Broken', timestamp: 'invalid' }
    ];
    const log = [
        { type: 'scene', value: 'Preshow', at: '2026-11-05T20:30:00Z' },
        { type: 'cue', value: 'Preshow', at: '2026-11-05T17:00:00Z' },
        { type: 'scene', value: 'Preshow', at: '2026-11-05T19:30:00Z' },
        { type: 'scene', value: 'Act One', at: 'invalid' }
    ];
    const times = NoteView.sceneStartTimes(notes, log);
    assert.equal(times.get('Preshow'), '2026-11-05T19:30:00.000Z');
    assert.equal(times.get('Act One'), '2026-11-05T21:00:00.000Z');
    assert.ok(!times.has('Broken'));
    assert.deepEqual([...NoteView.sceneStartTimes([...notes].reverse(), [...log].reverse())].sort(), [...times].sort());
    const time = TimecodeFormat.formatClockMinute(times.get('Preshow'));
    assert.match(time, /^\d{2}:\d{2}$/);
    assert.ok(NoteView.groupHeadHTML('Preshow', times.get('Preshow')).includes(`>${time}</time>`));
    assert.ok(!NoteView.groupHeadHTML('Broken', 'invalid').includes('<time'));
    assert.equal(TimecodeFormat.formatClockMinute(null), '');
});

test('scene groups keep a cross-scene submission with its starting scene', () => {
    const note = (id, act, second, started = second) => ({ id, act,
        timestamp: `2026-11-11T19:00:${second}.000Z`, startedAt: `2026-11-11T19:00:${started}.000Z` });
    const notes = [note('late', 'Song 1', '30', '05'), note('two', 'Song 2', '20'), note('one', 'Song 1', '10')];
    const groups = NoteView.groupNotes(notes);
    assert.deepStrictEqual(groups.map(g => [g.act, g.notes.map(n => n.id)]), [
        ['Song 2', ['two']], ['Song 1', ['late', 'one']]
    ]);
    assert.deepStrictEqual(notes.map(n => n.id), ['late', 'two', 'one']);
    // Even the first note for Song 1 can be submitted during Song 2.
    assert.deepStrictEqual(NoteView.groupNotes(notes.slice(0, 2)).map(g => g.act), ['Song 2', 'Song 1']);
});

test('a scene that returns later gets its own group at the current end', () => {
    const note = (id, act, minute) => ({ id, act, timestamp: `2026-11-11T19:${minute}:00.000Z` });
    // Oldest first: Preshow, Scene A, Scene B, then Preshow again.
    const oldest = [note('p1', 'Preshow', '00'), note('p2', 'Preshow', '01'), note('a', 'Scene A', '10'),
        note('b', 'Scene B', '20'), note('p3', 'Preshow', '30'), note('p4', 'Preshow', '31')];
    const groups = NoteView.groupNotes([...oldest].reverse());
    assert.deepStrictEqual(groups.map(g => [g.act, g.notes.map(n => n.id)]), [
        ['Preshow', ['p4', 'p3']], ['Scene B', ['b']], ['Scene A', ['a']], ['Preshow', ['p2', 'p1']]
    ]);
    // A scene that never returns still has a single group.
    assert.deepStrictEqual(NoteView.groupNotes(oldest.slice(0, 4).reverse()).map(g => g.act), ['Scene B', 'Scene A', 'Preshow']);
});

test('a returning scene keeps a note with the occurrence where it was started', () => {
    const note = (id, act, second, started = second) => ({ id, act,
        timestamp: `2026-11-11T19:00:${second}.000Z`, startedAt: `2026-11-11T19:00:${started}.000Z` });
    // 'late' was started in the first Preshow but sent after Scene A began.
    const notes = [note('p3', 'Preshow', '50'), note('a', 'Scene A', '30'), note('late', 'Preshow', '40', '05'), note('p1', 'Preshow', '10')];
    assert.deepStrictEqual(NoteView.groupNotes(notes).map(g => [g.act, g.notes.map(n => n.id)]), [
        ['Preshow', ['p3']], ['Scene A', ['a']], ['Preshow', ['late', 'p1']]
    ]);
});

test('scene grouping supports legacy stamps, ownerless scenes and empty lists', () => {
    const notes = [
        { id: 'b', act: 'Two', timestamp: '2026-11-11T19:02:00Z' },
        { id: 'a', act: 'One', timestamp: '2026-11-11T19:01:00Z' },
        { id: 'p', act: null, timestamp: '2026-11-11T19:00:00Z' }
    ];
    assert.deepStrictEqual(NoteView.groupNotes(notes).map(g => g.act), ['Two', 'One', 'Preshow']);
    assert.deepStrictEqual(NoteView.groupNotes([{ act: 'Two' }, { act: 'One' }, { act: 'Two' }]).map(g => g.notes.length), [2, 1]);
    assert.deepStrictEqual(NoteView.groupNotes([]), []);
});
