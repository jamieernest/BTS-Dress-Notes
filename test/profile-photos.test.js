const test = require('node:test');
const assert = require('node:assert/strict');
const { usernameFromClaims } = require('../profile-photos');
const Photos = require('../public/profile-photos');
const View = require('../public/note-view');
const Mentions = require('../public/mentions');
const { cleanStoredNotes } = require('../note-input');
const { sanitizeChatLog, boundChatMessage, messageKey } = require('../chat-restore');

test('only a Bath SSO account with a valid website username gets a photo', () => {
    assert.equal(usernameFromClaims({ email: 'alias@bath.ac.uk', preferred_username: 'abc12' }), 'abc12');
    assert.equal(usernameFromClaims({ email: 'ABC12@BATH.AC.UK', preferred_username: 'abc12' }), 'abc12');
    for (const email of ['abc12@gmail.com', 'abc12@bath.ac.uk.evil.test', 'a@@bath.ac.uk', '<img>@bath.ac.uk', null]) {
        assert.equal(usernameFromClaims({ email, preferred_username: 'abc12' }), undefined);
    }
    assert.equal(usernameFromClaims({ email: 'alias@bath.ac.uk' }), undefined, 'no guessing from editable email aliases');
    assert.equal(usernameFromClaims({ email: 'abc12@bath.ac.uk', preferred_username: '../other' }), undefined);
});

test('photo URLs are fixed HTTPS JPEG paths; hostile fields cannot become markup or URLs', () => {
    assert.equal(Photos.imageUrl('abc12'), 'https://www.bts-crew.com/images/profiles/abc12.jpg');
    assert.ok(View.avatarHTML('sub', 'Alice', 'sm').startsWith('<span class="avatar sm"'));
    for (const bad of ['../private', '..', '.', 'https://evil.test/a', 'javascript:alert(1)', 'a/b', 'a%2Fb', 'a?x', 'a#x', 'abc12\n', 'abc12\r', 'abc12\r\n', 'a" onerror="alert(1)', 'x'.repeat(101), {}, null]) {
        assert.equal(Photos.imageUrl(bad), '', String(bad));
        assert.doesNotMatch(View.avatarHTML('sub', '<img onerror=x>', 'sm', bad), /<img|onerror=/);
    }
    const html = View.avatarHTML('sub', 'Alice', 'sm', 'abc12');
    assert.match(html, /referrerpolicy="no-referrer"/);
    assert.match(html, /avatar-initials">A<\/span>/);
    assert.doesNotMatch(html, /\sonerror=/);
});

test('notes, comments, author filters and mention suggestions keep photo identities', () => {
    const [note] = cleanStoredNotes([{ id: 'n', userId: 'sub', user: 'Alice', emailPrefix: 'abc12',
        email: 'private@bath.ac.uk', username: 'private', text: 'Hi', timestamp: '2026-11-05T00:00:00Z',
        comments: [{ id: 'c', userId: 'sub2', user: 'Bob', emailPrefix: 'bob12', text: 'Reply' }] }]);
    assert.equal(note.email, undefined); assert.equal(note.username, undefined);
    assert.match(View.noteHTML(note), /profiles\/abc12\.jpg/);
    assert.match(View.commentHTML(note.comments[0]), /profiles\/bob12\.jpg/);
    assert.equal(View.authorOptions([note])[0].emailPrefix, 'abc12');
    assert.equal(Mentions.accounts([note], [], [])[0].emailPrefix, 'abc12');
    assert.equal(Mentions.accounts([], [], [{ id: 'sub', name: 'Alice', emailPrefix: 'abc12' }])[0].emailPrefix, 'abc12');
    const [bad] = cleanStoredNotes([{ ...note, emailPrefix: '../evil', comments: [{ ...note.comments[0], emailPrefix: '<svg>' }] }]);
    assert.equal(bad.emailPrefix, undefined); assert.equal(bad.comments[0].emailPrefix, undefined);
});

test('chat restore validates photos and requires agreement on identity metadata', () => {
    const message = { id: 'm1', user: 'Alice', userId: 'sub', text: '@Bob hi',
        mentions: [{ userId: 'b', name: 'Bob', start: 0, end: 4 }], replyTo: 'original',
        timestamp: '2026-11-05T00:00:00Z', emailPrefix: 'abc12' };
    assert.deepEqual(sanitizeChatLog([message]), [message]);
    assert.notEqual(messageKey(message), messageKey({ ...message, emailPrefix: 'bob12' }));
    assert.equal(sanitizeChatLog([{ ...message, emailPrefix: '<svg>' }])[0].emailPrefix, undefined);
    assert.equal(boundChatMessage({ ...message, emailPrefix: '../evil' }).emailPrefix, undefined);
    assert.equal(boundChatMessage(message).replyTo, 'original');
});
