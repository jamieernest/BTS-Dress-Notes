const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAdmins, parseAdminList, identifiersOf } = require('../admins');

const alice = { sub: 'sub-1', name: 'Alice A', username: 'alice', email: 'Alice@Example.com', emailVerified: true };
const bob = { sub: 'sub-2', name: 'Bob', username: 'bob', email: 'bob@example.com', emailVerified: true };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'admins-')), 'admins.json');

test('parseAdminList takes an array or { admins }, ignoring blanks and non-strings', () => {
    assert.deepStrictEqual(parseAdminList('["A@x.com", " bob ", "", 3, null]'), ['a@x.com', 'bob']);
    assert.deepStrictEqual(parseAdminList('{"admins":["Carol"]}'), ['carol']);
    assert.throws(() => parseAdminList('{"people":[]}'));
    assert.throws(() => parseAdminList('nope'));
});

test('a user is matched by sub, username or email, ignoring case', () => {
    const file = tmp();
    for (const entry of ['SUB-1', 'ALICE', 'alice@example.com']) {
        fs.writeFileSync(file, JSON.stringify([entry]));
        const admins = createAdmins({ file });
        assert.strictEqual(admins.isAdmin(alice), true, entry);
        assert.strictEqual(admins.isAdmin(bob), false, entry);
    }
});

test('a display name is not an identifier', () => {
    const file = tmp();
    fs.writeFileSync(file, JSON.stringify(['Alice A']));
    assert.strictEqual(createAdmins({ file }).isAdmin(alice), false);
});

test('an unverified email is not trusted, an unknown verification is', () => {
    assert.deepStrictEqual(identifiersOf({ sub: 's', email: 'e@x.com', emailVerified: false }), ['s']);
    assert.deepStrictEqual(identifiersOf({ sub: 's', email: 'e@x.com' }), ['s', 'e@x.com']);
    assert.deepStrictEqual(identifiersOf(null), []);
});

test('with no file and no ADMIN_USERS everybody is an admin', () => {
    const admins = createAdmins({ file: tmp() });
    assert.strictEqual(admins.isEnforced(), false);
    assert.strictEqual(admins.isAdmin(bob), true);
});

test('ADMIN_USERS alone is enforced, and adds to the file', () => {
    const file = tmp();
    const admins = createAdmins({ file, env: ' ALICE , nobody ' });
    assert.strictEqual(admins.isEnforced(), true);
    assert.strictEqual(admins.isAdmin(alice), true);
    assert.strictEqual(admins.isAdmin(bob), false);
    fs.writeFileSync(file, '["bob"]');
    assert.strictEqual(admins.isAdmin(bob), true);
    assert.strictEqual(admins.isAdmin(alice), true);
});

test('an empty list or an unreadable file locks everybody out rather than letting everybody in', () => {
    const file = tmp();
    const logged = [];
    const admins = createAdmins({ file, log: (m) => logged.push(m) });
    fs.writeFileSync(file, '[]');
    assert.strictEqual(admins.isEnforced(), true);
    assert.strictEqual(admins.isAdmin(alice), false);
    fs.writeFileSync(file, '["alice",');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.strictEqual(admins.isAdmin(alice), false);
    assert.strictEqual(logged.length, 1);
    assert.match(logged[0], /nobody is an admin/);
});

test('editing the file takes effect without a restart, and removing it turns the check off', () => {
    const file = tmp();
    fs.writeFileSync(file, '["alice"]');
    const admins = createAdmins({ file });
    assert.strictEqual(admins.isAdmin(bob), false);
    fs.writeFileSync(file, '["alice","bob"]');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.strictEqual(admins.isAdmin(bob), true);
    fs.rmSync(file);
    assert.strictEqual(admins.isEnforced(), false);
});

test('nobody signed in is never an admin once a list exists', () => {
    const file = tmp();
    fs.writeFileSync(file, '["alice"]');
    assert.strictEqual(createAdmins({ file }).isAdmin(undefined), false);
});
