const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

test('signed-in photo identity cannot be spoofed and survives notes/chat restart without leaking email', async t => {
    const oidc = await startOidc({ claims: {
        alice: { email: 'alias@bath.ac.uk', preferred_username: 'abc12' },
        bob: { email: 'bob@gmail.com', preferred_username: 'bob12' }
    } });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-photos-e2e-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    const browsers = [];
    t.after(async () => { browsers.forEach(b => b.close()); await app.stop(); oidc.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    await app.start();
    const cookies = [];
    for (const who of ['alice', 'bob']) {
        const cookie = await login(app, oidc, who); cookies.push(cookie);
        browsers.push(new Browser(app, cookie));
    }
    const [a,b] = browsers;
    let current, users;
    a.load(); a.page.socket.on('current-user', value => { current = value; });
    a.page.socket.on('users-update', value => { users = value; });
    b.load();
    await until(() => a.page.log && b.page.log && current && users?.length === 2, 'signed-in state');
    assert.equal(current.emailPrefix, 'abc12');
    const alice = users.find(u => u.id === 'sub-alice'), bob = users.find(u => u.id === 'sub-bob');
    assert.equal(alice.emailPrefix, 'abc12'); assert.equal(bob.emailPrefix, undefined);
    assert.equal(alice.email, undefined); assert.equal(alice.username, undefined);
    const base = `http://127.0.0.1:${app.port}`;
    const response = await fetch(base, { headers: { cookie: cookies[0] } });
    assert.match(response.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/www\.bts-crew\.com;/);
    const payload = { text: 'Photo note', tags: ['lx'], email: 'spoof@bath.ac.uk', emailPrefix: 'spoof', username: 'spoof' };
    const note = await new Promise(resolve => a.page.socket.emit('note-submit', payload, resolve));
    assert.equal(note.emailPrefix, 'abc12'); assert.equal(note.email, undefined); assert.equal(note.username, undefined);
    const comment = new Promise(resolve => a.page.socket.once('comment-submit', value => resolve(value.comment)));
    a.page.socket.emit('comment-submit', { ...payload, noteId: note.id });
    assert.equal((await comment).emailPrefix, 'abc12');
    const agreed = await a.page.socket.timeout(3000).emitWithAck('note-agreement-toggle', { noteId: note.id, emailPrefix: 'spoof' });
    assert.deepEqual(agreed.agreements, [{ userId: 'sub-alice', name: agreed.agreements[0].name, emailPrefix: 'abc12' }]);
    b.page.socket.emit('chat-message', payload);
    await until(() => a.page.log.length === 1, 'non-Bath chat');
    assert.equal(a.page.log[0].emailPrefix, undefined);
    a.page.socket.emit('chat-message', { ...payload, replyTo: a.page.log[0].id });
    await until(() => a.page.log.length === 2 && b.page.log.length === 2, 'photo reply');
    assert.equal(a.page.log[1].emailPrefix, 'abc12');
    await app.stop(); a.close(); b.close();
    await app.start(); a.load(); b.load();
    await until(() => a.page.notes?.length === 1 && a.page.log?.length === 2, 'restored photo identities');
    assert.equal(a.page.notes[0].emailPrefix, 'abc12');
    assert.equal(a.page.notes[0].comments[0].emailPrefix, 'abc12');
    assert.equal(a.page.log[1].emailPrefix, 'abc12'); assert.ok(a.page.log[1].replyTo);
    const exported = await (await fetch(`${base}/playback/live`, { headers: { cookie: cookies[0] } })).text();
    assert.ok(exported.includes('abc12'));
    assert.ok(!exported.includes('alias@bath.ac.uk')); assert.ok(!exported.includes('spoof@bath.ac.uk'));
});
