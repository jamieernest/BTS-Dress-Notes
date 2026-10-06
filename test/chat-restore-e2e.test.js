// Runs the real server (login included, against a stub OIDC provider) with two
// signed-in users, stops and restarts it, and checks the chat comes back. A
// "browser" is a Socket.IO client plus a storage object that outlives page
// loads, driven by the same public/chat-copy.js the page uses, so a reload is
// modelled as throwing the client away and building a new one over the same
// storage. Only the DOM is left out.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const jose = require('jose');
const createChatCopyModule = require('../public/chat-copy.js');
const { createChatCopy, MAX_AGE_MS } = createChatCopyModule;

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, what, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
        await sleep(25);
    }
}

function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

// Stub OIDC provider: whoever /authorize is asked for next is `nextUser`.
async function startOidc() {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const port = await freePort();
    const issuer = `http://127.0.0.1:${port}`;
    const codes = new Map();
    const state = { nextUser: 'alice' };
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, issuer);
        const json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        if (url.pathname === '/.well-known/openid-configuration') {
            return json({
                issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
                jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'],
                id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
                token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
            });
        }
        if (url.pathname === '/jwks') return json({ keys: [jwk] });
        if (url.pathname === '/authorize') {
            const code = Math.random().toString(36).slice(2);
            codes.set(code, state.nextUser);
            const back = new URL(url.searchParams.get('redirect_uri'));
            back.searchParams.set('code', code);
            back.searchParams.set('state', url.searchParams.get('state'));
            back.searchParams.set('iss', issuer);
            res.statusCode = 302;
            res.setHeader('location', back.href);
            return res.end();
        }
        if (url.pathname === '/token') {
            let body = '';
            for await (const chunk of req) body += chunk;
            const who = codes.get(new URLSearchParams(body).get('code'));
            const idToken = await new jose.SignJWT({ name: who })
                .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
                .setIssuer(issuer).setAudience('bts').setSubject(`sub-${who}`)
                .setIssuedAt().setExpirationTime('1h').sign(privateKey);
            return json({ access_token: 'a', token_type: 'Bearer', id_token: idToken, expires_in: 3600 });
        }
        res.statusCode = 404;
        res.end();
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    return { issuer, state, close: () => server.close() };
}

// The app, started as `node server.js` the way it runs for real.
function createApp({ issuer, sessionsFile, port }) {
    let child = null;
    return {
        port,
        async start() {
            const oscPort = await freePort();
            child = spawn(process.execPath, ['server.js'], {
                cwd: ROOT,
                env: {
                    ...process.env, PORT: String(port), OSC_PORT: String(oscPort), SESSIONS_FILE: sessionsFile,
                    SESSION_SECRET: 'test', KEYCLOAK_ISSUER: issuer, KEYCLOAK_CLIENT_ID: 'bts',
                    KEYCLOAK_CLIENT_SECRET: 'x', EOS_HOST: '127.0.0.1', EOS_PORT: String(await freePort())
                },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let out = '';
            child.stdout.on('data', (d) => { out += d; });
            child.stderr.on('data', (d) => { out += d; });
            await until(() => out.includes('Server running on'), `server to start:\n${out}`);
        },
        async stop() {
            const exited = new Promise((resolve) => child.once('exit', resolve));
            child.kill('SIGINT');
            await exited;
        }
    };
}

// Logs in through the real /login -> OIDC -> /callback flow; returns the session cookie.
async function login(app, oidc, who) {
    oidc.state.nextUser = who;
    const base = `http://127.0.0.1:${app.port}`;
    let res = await fetch(`${base}/login`, { redirect: 'manual' });
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    res = await fetch(res.headers.get('location'), { redirect: 'manual' });
    res = await fetch(res.headers.get('location'), { redirect: 'manual', headers: { cookie } });
    assert.strictEqual(res.status, 302, 'login callback should redirect');
    return cookie;
}

// One person's browser: cookie jar and localStorage live as long as the test.
class Browser {
    constructor(app, cookie) {
        this.app = app;
        this.cookie = cookie;
        this.items = new Map();
        this.storage = {
            getItem: (key) => (this.items.has(key) ? this.items.get(key) : null),
            setItem: (key, value) => { this.items.set(key, value); }
        };
        this.page = null;
    }

    // Loads the page: a fresh client over this browser's storage.
    load() {
        this.close();
        const chatCopy = createChatCopy(this.storage);
        const page = { log: null, socket: null };
        page.socket = io(`http://127.0.0.1:${this.app.port}`, {
            extraHeaders: { cookie: this.cookie }, reconnectionDelay: 50, reconnectionDelayMax: 200
        });
        page.socket.on('chat-message-added', (msg) => {
            page.log.push(msg);
            chatCopy.onMessageAdded(page.log);
        });
        page.socket.on('chat-messages-update', (msgs) => {
            const offer = chatCopy.onServerLog(msgs);
            if (offer) page.socket.emit('chat-restore-offer', offer);
            page.log = msgs;
        });
        this.page = page;
        return page;
    }

    say(text) { this.page.socket.emit('chat-message', { text }); }
    texts() { return this.page.log ? this.page.log.map((m) => m.text) : null; }
    close() { if (this.page) this.page.socket.close(); this.page = null; }
}

// What the server itself holds: a new user's first chat update on connecting.
function serverLog(app, cookie) {
    return new Promise((resolve) => {
        const socket = io(`http://127.0.0.1:${app.port}`, { extraHeaders: { cookie }, reconnection: false });
        socket.on('chat-messages-update', (msgs) => { socket.close(); resolve(msgs.map((m) => m.text)); });
        socket.on('connect_error', () => { socket.close(); resolve(null); });
    });
}

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-restore-e2e-'));
    const sessionsFile = path.join(dir, 'sessions.json');
    const app = createApp({ issuer: oidc.issuer, sessionsFile, port: await freePort() });
    await app.start();
    const alice = new Browser(app, await login(app, oidc, 'alice'));
    const bob = new Browser(app, await login(app, oidc, 'bob'));
    t.after(async () => {
        alice.close();
        bob.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    alice.load();
    bob.load();
    alice.say('hello from alice');
    await until(() => bob.texts()?.length === 1, 'bob to see the first message'); // keeps the order fixed
    bob.say('hello from bob');
    await until(() => alice.texts()?.length === 2 && bob.texts()?.length === 2, 'both browsers to see the chat');
    const carol = await login(app, oidc, 'carol');
    return { oidc, app, alice, bob, carol, sessionsFile, expected: ['hello from alice', 'hello from bob'] };
}

test('two users who stay on their pages get the chat back after a restart', async (t) => {
    const { app, alice, bob, carol, expected } = await setup(t);
    await app.stop();
    await app.start();
    await until(async () => (await serverLog(app, carol))?.length, 'the chat to be restored');
    assert.deepStrictEqual(await serverLog(app, carol), expected);
    await until(() => alice.texts()?.length && bob.texts()?.length, 'both pages to show the chat');
    assert.deepStrictEqual(alice.texts(), expected);
    assert.deepStrictEqual(bob.texts(), expected);
});

test('two users who reload their pages while the server is down get the chat back', async (t) => {
    const { app, alice, bob, carol, expected } = await setup(t);
    await app.stop();
    alice.close();
    bob.close();
    await app.start();
    alice.load();
    bob.load();
    await until(async () => (await serverLog(app, carol))?.length, 'the chat to be restored');
    assert.deepStrictEqual(await serverLog(app, carol), expected);
    await until(() => alice.texts()?.length && bob.texts()?.length, 'both pages to show the chat');
    assert.deepStrictEqual(alice.texts(), expected);
    assert.deepStrictEqual(bob.texts(), expected);
});

test('two users sent back through login after a restart get the chat back', async (t) => {
    const { oidc, app, alice, bob, sessionsFile, expected } = await setup(t);
    await app.stop();
    alice.close();
    bob.close();
    fs.rmSync(sessionsFile, { force: true }); // the restart lost every login session
    await app.start();
    alice.cookie = await login(app, oidc, 'alice');
    bob.cookie = await login(app, oidc, 'bob');
    const carol = await login(app, oidc, 'carol');
    alice.load();
    bob.load();
    await until(async () => (await serverLog(app, carol))?.length, 'the chat to be restored');
    assert.deepStrictEqual(await serverLog(app, carol), expected);
    await until(() => alice.texts()?.length && bob.texts()?.length, 'both pages to show the chat');
    assert.deepStrictEqual(alice.texts(), expected);
    assert.deepStrictEqual(bob.texts(), expected);
});

test('one user reloading in two tabs does not count as two users', async (t) => {
    const { app, alice, bob, carol } = await setup(t);
    await app.stop();
    alice.close();
    bob.close(); // bob is away: only alice's browser offers the log
    await app.start();
    alice.load();
    const second = new Browser(app, alice.cookie);
    second.items = alice.items;
    second.load();
    t.after(() => second.close());
    await sleep(500);
    assert.deepStrictEqual(await serverLog(app, carol), []);
});

test('a chat copy older than the login session is not offered', () => {
    let clock = 1_000_000;
    const items = new Map();
    const storage = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
    createChatCopy(storage, () => clock).onMessageAdded([{ id: 'a' }]);
    clock += MAX_AGE_MS - 1;
    assert.deepStrictEqual(createChatCopy(storage, () => clock).onServerLog([]), [{ id: 'a' }]);
    clock += 1;
    assert.strictEqual(createChatCopy(storage, () => clock).onServerLog([]), null);
});

test('blocked or corrupt storage leaves no copy and does not throw', () => {
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const copy = createChatCopy(blocked);
    assert.strictEqual(copy.onServerLog([]), null);
    copy.onMessageAdded([{ id: 'a' }]);
    assert.deepStrictEqual(copy.onServerLog([]), [{ id: 'a' }]); // still held in page memory
    assert.strictEqual(createChatCopy({ getItem: () => '{nope', setItem() {} }).onServerLog([]), null);
});
