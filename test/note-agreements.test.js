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
