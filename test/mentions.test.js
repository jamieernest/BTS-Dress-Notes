const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../public/mentions');
const { cleanStoredNotes } = require('../note-input');
const { sanitizeChatLog, messageKey, boundChatMessage } = require('../chat-restore');
const { noteMatches, noteHTML, commentHTML } = require('../public/note-view');
const mention = (userId = 'sub-bob', name = 'Bob') => ({ userId, name, start: 0, end: name.length + 1 });
test('duplicate names stay separate by stable account; raw names never mention anyone', () => {
    const people = M.accounts([{ userId: 'a', user: 'Sam' }], [{ userId: 'b', user: 'Sam' }], [{ id: 'a', name: 'Sam' }]);
    assert.equal(people.length, 2);
    assert.equal(M.has({ text: '@Sam' }, 'a'), false);
    assert.equal(M.has({ text: '@Sam', mentions: [mention('b', 'Sam')] }, 'a'), false);
    assert.equal(M.has({ text: '@Sam', mentions: [mention('b', 'Sam')] }, 'b'), true);
});
test('bounded explicit ranges, escaping, edits and shared filtering', () => {
    const n = { id: 'n', text: '@Bob <script>', mentions: [mention()], tags: [], act: 'Preshow' };
    assert.match(noteHTML(n), /<strong class="mention">@Bob<\/strong> &lt;script&gt;/);
    assert.match(commentHTML(n), /class="mention"/);
    assert.deepEqual(M.clean(n.text, [mention(), mention('other'), { ...mention(), end: 999 }]), [mention()]);
    assert.deepEqual(M.clean('@Bob', [{ ...mention(), userId: 'x'.repeat(201) }]), []);
    assert.deepEqual(M.rebase('@Bob', 'Hi @Bob', [mention()]), [{ ...mention(), start: 3, end: 7 }]);
    assert.deepEqual(M.rebase('@Bob', '@Bobby', [mention()]), [mention()]); // suffix outside the range
    assert.deepEqual(M.rebase('@Bob', '@Rob', [mention()]), []);
    assert.equal(noteMatches(n, { tag: 'all', act: 'all', search: '', mentionedUserId: 'sub-bob' }), true);
    assert.equal(noteMatches(n, { tag: 'all', act: 'all', search: '', mentionedUserId: 'other' }), false);
});
test('backup and chat restore preserve canonical metadata; differing recipients cannot vouch for one another', () => {
    const msg = { id: 'm', user: 'Alice', userId: 'sub-alice', text: '@Bob', mentions: [mention()], timestamp: new Date().toISOString() };
    assert.deepEqual(sanitizeChatLog([msg]), [msg]);
    assert.deepEqual(cleanStoredNotes([{ ...msg, tags: [], comments: [msg] }])[0].mentions, msg.mentions);
    assert.deepEqual(cleanStoredNotes([{ ...msg, tags: [], comments: [msg] }])[0].comments[0].mentions, msg.mentions);
    assert.notEqual(messageKey(msg), messageKey({ ...msg, mentions: [mention('other')] }));
    assert.deepEqual(boundChatMessage(msg).mentions, msg.mentions);
    assert.equal(sanitizeChatLog([{ ...msg, mentions: undefined }])[0].mentions, undefined);
});
test('badge counts only unseen incoming mentions; viewing, reload, reconnect, self and resets', () => {
    const items = new Map();
    const storage = { getItem: key => items.get(key), setItem: (key, value) => items.set(key, value) };
    const msg = { id: 'm', userId: 'alice', text: '@Bob', mentions: [mention()] };
    let badge = M.createUnread(storage);
    assert.equal(badge.receive([msg, msg, { ...msg, id: 'self', userId: 'sub-bob' }], 'sub-bob', false), 1);
    badge = M.createUnread(storage);
    assert.equal(badge.receive([msg], 'sub-bob', false), 1);
    assert.equal(badge.receive([msg], 'sub-bob', true), 0);
    badge = M.createUnread(storage);
    assert.equal(badge.receive([msg], 'sub-bob', false), 0);
    assert.equal(badge.receive([{ ...msg, id: 'new' }], 'sub-bob', false), 1);
    badge.reset();
    assert.equal(badge.receive([], 'sub-bob', false), 0);
});


test('reply and mention metadata coexist and both participate in restore agreement', () => {
    const message = { id: 'reply', user: 'Alice', userId: 'sub-alice', text: '@Bob', mentions: [mention()], replyTo: 'original', timestamp: new Date().toISOString() };
    assert.deepEqual(sanitizeChatLog([message]), [message]);
    assert.equal(boundChatMessage(message).replyTo, 'original');
    assert.deepEqual(boundChatMessage(message).mentions, message.mentions);
    assert.notEqual(messageKey(message), messageKey({ ...message, replyTo: 'different' }));
    assert.notEqual(messageKey(message), messageKey({ ...message, mentions: [mention('other')] }));
});


test('composing highlights only selected account ranges and escapes all text', () => {
    const text = '@Bob <img src=x onerror="alert(1)">';
    assert.equal(M.html(text, [mention()], true), '<span class="mention-compose">@Bob</span> &lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(M.html('@Bob', [], true), '@Bob', 'typing a name does not silently select an account');
    assert.equal(M.html('@Bob', [{ ...mention(), userId: '' }], true), '@Bob');
    assert.equal(M.html('@Rob', [mention()], true), '@Rob', 'editing through a mention removes its identity highlight');
});
test('picker survives its own scroll, closes on page scroll, and only commits on click', () => {
    const listeners = {};
    const on = (target, type, fn) => { (listeners[target.name + ':' + type] ||= []).push(fn); };
    const fire = (name, type, event) => (listeners[name + ':' + type] || []).forEach(fn => fn(event));
    const element = name => ({
        name, hidden: false, style: {}, dataset: {}, classList: { toggle() {} }, value: '', id: '',
        append() {}, before() {}, setAttribute() {}, removeAttribute() {}, focus() {}, observe() {},
        addEventListener(type, fn) { on(this, type, fn); },
        contains(t) { return t === this || t?.inside === this; },
        setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
        dispatchEvent() {}, matches: () => true
    });
    const doc = element('document'), win = element('window'), menu = element('menu'), input = element('input');
    doc.createElement = () => (menu.created ? element('other') : (menu.created = true, menu));
    doc.body = element('body');
    doc.querySelectorAll = () => [];
    const saved = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle, ResizeObserver: globalThis.ResizeObserver };
    Object.assign(globalThis, { document: doc, window: win, getComputedStyle: () => ({}), ResizeObserver: class { observe() {} } });
    try {
        M.install({ getAccounts: () => [{ userId: 'sub-bob', name: 'Bob' }], seed: () => null, avatarHTML: () => '', place() {} });
        const open = () => {
            input.value = '@Bo'; input.selectionStart = input.selectionEnd = 3; input.id = 'noteInput';
            fire('document', 'input', { target: input, stopImmediatePropagation() {} });
            menu.hidden = false;
        };
        const row = { inside: menu, closest: () => ({ dataset: { choice: '0' } }) };
        open();
        fire('document', 'scroll', { target: row });
        assert.equal(menu.hidden, false, 'scrolling inside the picker keeps it open');
        fire('document', 'scroll', { target: {} });
        assert.equal(menu.hidden, true, 'scrolling the page closes it');
        open();
        fire('menu', 'pointerdown', { target: row });
        assert.equal(input.value, '@Bo', 'pointerdown alone does not choose');
        fire('menu', 'click', { target: row });
        assert.equal(input.value, '@Bob ', 'click chooses the person');
        assert.equal(menu.hidden, true);
    } finally { Object.assign(globalThis, saved); }
});
