const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanAgreements, toggleAgreement, MAX_AGREEMENTS } = require('../note-agreements');
const { cleanStoredNotes } = require('../note-input');
const NoteView = require('../public/note-view');

test('agreement cleaning bounds, rebuilds and deduplicates imported people; legacy notes remain valid', () => {
    const people = [{ userId: 'a', name: 'Alice', extra: true }, { userId: 'a', name: 'Other' }, null, { userId: '', name: 'Bad' }];
    assert.deepEqual(cleanAgreements(people), [{ userId: 'a', name: 'Alice' }]);
    assert.deepEqual(cleanAgreements({}), []);
    assert.equal(cleanAgreements(Array.from({ length: 2000 }, (_, i) => ({ userId: String(i), name: 'A' }))).length, MAX_AGREEMENTS);
    const legacy = { id: 'n', text: 'Hello', timestamp: new Date().toISOString() };
    assert.equal(cleanStoredNotes([legacy]).length, 1);
    assert.deepEqual(cleanStoredNotes([{ ...legacy, agreements: people }])[0].agreements, [{ userId: 'a', name: 'Alice' }]);
    const comment = { id: 'c', user: 'Alice', text: 'A reply', agreements: people };
    assert.deepEqual(cleanStoredNotes([{ ...legacy, comments: [comment] }])[0].comments[0].agreements, [{ userId: 'a', name: 'Alice' }]);
    assert.equal(cleanStoredNotes([{ ...legacy, comments: [{ ...comment, agreements: undefined }] }])[0].comments[0].agreements, undefined);
});

test('comment agreements reuse the quiet controls with a reply target, escaped people and read-only history', () => {
    const comment = { id: 'c', user: 'Alice', text: 'A reply', agreements: [{ userId: 'b', name: '<Bob>' }] };
    const live = NoteView.commentHTML(comment, { agreementActor: 'a' });
    assert.match(live, /data-action="agree-comment"/);
    assert.match(live, /Agree with this reply/);
    assert.match(live, /&lt;Bob&gt;/);
    const past = NoteView.commentHTML(comment);
    assert.match(past, /See who agrees \(1\)/);
    assert.doesNotMatch(past, /data-action="agree-comment"|agreement-toggle/);
});

test('one agreement per account, toggling removes it and a full note still allows removal', () => {
    const note = {};
    const actor = { userId: 'sub-a', name: 'Alice' };
    assert.equal(toggleAgreement(note, actor), true);
    assert.deepEqual(note.agreements, [actor]);
    toggleAgreement(note, { ...actor, name: 'New name' });
    assert.deepEqual(note.agreements, []);
    note.agreements = Array.from({ length: MAX_AGREEMENTS }, (_, i) => ({ userId: String(i), name: 'A' }));
    assert.equal(toggleAgreement(note, actor), false);
    assert.equal(toggleAgreement(note, { userId: '0', name: 'A' }), true);
    assert.equal(note.agreements.length, MAX_AGREEMENTS - 1);
});

test('shared agreement formatting escapes names, displays avatars/count, and keeps Past notes read only', () => {
    const note = { agreements: [{ userId: 'a', name: '<Alice>' }, { userId: 'a', name: 'Duplicate' }] };
    const live = NoteView.agreementsHTML(note, 'a');
    assert.match(live, /aria-pressed="true"/);
    assert.match(live, /Remove your agreement/);
    assert.match(live, /&lt;Alice&gt;/);
    assert.match(live, /class="avatar sm"/);
    assert.match(live, /See who agrees \(1\)/);
    const past = NoteView.agreementsHTML(note);
    assert.doesNotMatch(past, /<button|data-action|Duplicate/);
    assert.match(past, /<details/);
    assert.equal(NoteView.agreementsHTML({}), '');
    assert.match(NoteView.agreementsHTML({}, 'b'), /aria-pressed="false"/);
});


test('agreement controls retain both slots at zero, one and multiple people', () => {
    for (const agreements of [[], [{ userId: 'a', name: 'Alice' }], [{ userId: 'a', name: 'Alice' }, { userId: 'b', name: 'Bob' }]]) {
        const html = NoteView.agreementsHTML({ agreements }, 'actor');
        assert.match(html, /class="icon-btn agreement-toggle"/);
        assert.match(html, /class="agreement-count"/);
        assert.match(html, new RegExp('See who agrees \\(' + agreements.length + '\\)'));
        assert.match(html, new RegExp('>' + agreements.length + '<\\/summary>'));
        assert.doesNotMatch(html, /\\+1|agreement-count"[^>]*hidden/);
    }
    assert.match(NoteView.agreementsHTML({}, 'actor'), /No agreements yet\./);
    assert.equal(NoteView.updateAgreements(null, {}, 'actor'), false);
});
