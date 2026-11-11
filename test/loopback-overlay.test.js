// Overlays skip the Keycloak login only when the raw connection is loopback.
const test = require('node:test');
const assert = require('node:assert');
const { io } = require('socket.io-client');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const lo = require('../loopback-overlay');
const { until, freePort, startOidc, createApp } = require('./e2e-harness');

const req = (remoteAddress, path, headers = {}) => ({ socket: { remoteAddress }, path, headers });

test('loopback overlay requests are allowed', () => {
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        for (const p of ['/overlay.html', '/overlay-cast.html', '/overlay.js', '/overlay-style.css']) {
            assert.ok(lo.isLoopbackOverlayRequest(req(addr, p)), `${addr} ${p}`);
        }
        assert.ok(lo.isLoopbackOverlayRequest({ ...req(addr, '/session'), query: { overlay: '1' } }));
        assert.ok(!lo.isLoopbackOverlayRequest(req(addr, '/session')));
    }
});

test('loopback requests to other pages still need a login', () => {
    for (const p of ['/', '/config.html', '/recall.html', '/index.js', '/shows', '/playback/live']) {
        assert.ok(!lo.isLoopbackOverlayRequest(req('127.0.0.1', p)), p);
    }
});

test('remote overlay requests still need a login, however they look', () => {
    assert.ok(!lo.isLoopbackOverlayRequest(req('192.168.1.20', '/overlay.html')));
    assert.ok(!lo.isLoopbackOverlayRequest(req('::ffff:192.168.1.20', '/overlay.html')));
    assert.ok(!lo.isLoopbackOverlayRequest(req('127.0.0.1', '/overlay.html', { 'x-forwarded-for': '10.0.0.5' })));
    assert.ok(!lo.isLoopbackOverlayRequest(req('192.168.1.20', '/overlay.html', { host: 'localhost', origin: 'http://localhost' })));
});

test('overlay sockets: loopback only, and only the overlay page', () => {
    const sock = (addr, headers) => ({ request: req(addr, '/', headers) });
    assert.ok(lo.isLoopbackOverlaySocket(sock('127.0.0.1'), 'overlay'));
    assert.ok(!lo.isLoopbackOverlaySocket(sock('127.0.0.1'), 'main'));
    assert.ok(!lo.isLoopbackOverlaySocket(sock('127.0.0.1'), 'config'));
    assert.ok(!lo.isLoopbackOverlaySocket(sock('10.0.0.9'), 'overlay'));
    assert.ok(!lo.isLoopbackOverlaySocket(sock('127.0.0.1', { 'x-forwarded-for': '10.0.0.9' }), 'overlay'));
});

test('running server: loopback overlay needs no login, everything else does', async (t) => {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-overlay-'));
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort() });
    await app.start();
    t.after(async () => { await app.stop().catch(() => {}); oidc.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${app.port}`;
    const get = (p, headers) => fetch(base + p, { redirect: 'manual', headers });

    for (const p of ['/overlay.html', '/overlay-cast.html', '/overlay.js', '/overlay-cast.js', '/overlay-style.css', '/keepalive.js', '/timecode-format.js']) {
        assert.strictEqual((await get(p)).status, 200, p);
    }
    assert.strictEqual((await get('/session?overlay=1', { accept: 'application/json' })).status, 200);
    assert.strictEqual((await get('/session', { accept: 'application/json' })).status, 401);
    assert.strictEqual((await get('/config.html', { accept: 'text/html' })).status, 302);
    assert.strictEqual((await get('/', { accept: 'text/html' })).status, 302);
    assert.strictEqual((await get('/index.js', { accept: '*/*' })).status, 401);
    assert.strictEqual((await get('/overlay.html', { 'x-forwarded-for': '203.0.113.9', accept: 'text/html' })).status, 302);

    const connect = (page, extra = {}) => io(base, { auth: { page }, reconnection: false, ...extra });
    const overlay = connect('overlay');
    t.after(() => overlay.close());
    await until(() => overlay.connected, 'loopback overlay socket to connect');
    overlay.emit('reset-all');

    const main = connect('main');
    t.after(() => main.close());
    const err = await new Promise((resolve) => main.on('connect_error', resolve));
    assert.match(err.message, /unauthorized/);
    const forwarded = connect('overlay', { extraHeaders: { 'x-forwarded-for': '203.0.113.9' } });
    t.after(() => forwarded.close());
    assert.match((await new Promise((resolve) => forwarded.on('connect_error', resolve))).message, /unauthorized/);
});
