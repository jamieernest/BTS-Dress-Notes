// Shared by the end-to-end tests: runs the real server (login included,
// against a stub OIDC provider) and drives it with Socket.IO clients.
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const jose = require('jose');
const { createChatCopy } = require('../public/chat-copy.js');

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
            const idToken = await new jose.SignJWT({ name: who, preferred_username: who, email: `${who}@example.com`, email_verified: true })
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
function createApp({ issuer, sessionsFile, port, env = {} }) {
    let child = null;
    const backupsDir = path.join(path.dirname(sessionsFile), 'backups');
    return {
        port,
        backupsDir,
        adminsFile: path.join(path.dirname(sessionsFile), 'admins.json'),
        // Kills the process without the shutdown backup, as a crash or power cut would.
        async kill() {
            const exited = new Promise((resolve) => child.once('exit', resolve));
            child.kill('SIGKILL');
            await exited;
        },
        async start() {
            const oscPort = await freePort();
            child = spawn(process.execPath, ['server.js'], {
                cwd: ROOT,
                env: {
                    ...process.env, PORT: String(port), OSC_PORT: String(oscPort), SESSIONS_FILE: sessionsFile,
                    BACKUPS_DIR: backupsDir,
                    // no admin list unless a test writes `adminsFile`, so by default everybody is an admin
                    ADMINS_FILE: path.join(path.dirname(sessionsFile), 'admins.json'), ADMIN_USERS: '',
                    SESSION_SECRET: 'test', KEYCLOAK_ISSUER: issuer, KEYCLOAK_CLIENT_ID: 'bts',
                    KEYCLOAK_CLIENT_SECRET: 'x', EOS_HOST: '127.0.0.1', EOS_PORT: String(await freePort()), ...env
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
            if (page.log.some((m) => m.id === msg.id)) return;
            page.log.push(msg);
            chatCopy.onMessageAdded(page.log);
        });
        page.socket.on('chat-restore-status', ({ open }) => chatCopy.onRestoreStatus(open));
        page.socket.on('chat-messages-update', (msgs) => {
            const offer = chatCopy.onServerLog(msgs);
            if (offer) page.socket.emit('chat-restore-offer', offer);
            page.log = msgs;
        });
        page.notes = [];
        page.socket.on('notes-update', (notes) => { page.notes = notes; });
        page.socket.on('note-added', (note) => { page.notes.push(note); });
        // The page forgets its saved chat copy when the server is reset.
        page.socket.on('all-reset', () => chatCopy.onReset());
        this.page = page;
        return page;
    }

    note(text, extra = {}) { this.page.socket.emit('note-submit', { text, clientId: `c-${Math.random().toString(36).slice(2)}`, ...extra }); }
    noteTexts() { return this.page.notes.map((n) => n.text); }
    say(text) { this.page.socket.emit('chat-message', { text }); }
    texts() { return this.page.log ? this.page.log.map((m) => m.text) : null; }
    // What this browser has saved in localStorage.
    savedTexts() { return JSON.parse(this.items.get('chat-log-copy')).log.map((m) => m.text); }
    // The config page: a socket whose referer says so.
    static configSocket(app, cookie) {
        return io(`http://127.0.0.1:${app.port}`, {
            extraHeaders: { cookie, referer: `http://127.0.0.1:${app.port}/config.html` }, reconnection: false
        });
    }
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


module.exports = { ROOT, sleep, until, freePort, startOidc, createApp, login, Browser, serverLog };
