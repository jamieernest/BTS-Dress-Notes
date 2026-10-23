const test = require('node:test');
const assert = require('node:assert');
const TimecodeFormat = require('../public/timecode-format.js');
const NoteView = require('../public/note-view.js');

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
