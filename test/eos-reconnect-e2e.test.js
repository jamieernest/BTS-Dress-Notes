// Runs the real server against a stand-in Eos console (a TCP listener) and
// checks the config page's reconnect control: it connects after a refused
// start, replaces a live connection with exactly one socket, and cues still
// flow afterwards. See connectToEOS() in server.js.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

// A captured SLIP-framed "active cue text" packet: 1/1899 B/O 3.0 100%
const CUE_PACKET = Buffer.from('c02f656f732f6f75742f6163746976652f6375652f74657874000000002c730000312f3138393920422f4f20332e30203130302500c0', 'hex');

// Stand-in console: keeps its connections and what each one has received.
function createConsole(port) {
    const conns = [];
    const server = net.createServer((socket) => {
        const conn = { socket, received: Buffer.alloc(0), closed: false };
        socket.on('data', (d) => { conn.received = Buffer.concat([conn.received, d]); });
        socket.on('close', () => { conn.closed = true; });
        socket.on('error', () => {});
        conns.push(conn);
    });
    return {
        conns,
        live: () => conns.filter((c) => !c.closed),
        listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
        close: () => new Promise((resolve) => { conns.forEach((c) => c.socket.destroy()); server.close(resolve); })
    };
}

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-reconnect-e2e-'));
    const eosPort = await freePort();
    const eos = createConsole(eosPort);
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort(), env: { EOS_PORT: String(eosPort) } });
    await app.start();
    const cookie = await login(app, oidc, 'alice');
    const config = Browser.configSocket(app, cookie);
    const status = { last: null, history: [] };
    config.on('eos-status', (s) => { status.last = { ...s }; status.history.push(s.state); });
    const cues = [];
    config.on('lx-cue-update', (c) => cues.push(c));
    t.after(async () => {
        config.close();
        await eos.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    // Nothing is listening yet, so the start-up attempt is refused.
    await until(() => status.last?.state === 'failed', 'refused start to show as failed');
    return { app, eos, config, status, cues, cookie };
}

test('a press connects and subscribes once the console is up', async (t) => {
    const { eos, config, status } = await setup(t);
    assert.match(status.last.error, /ECONNREFUSED/);

    await eos.listen();
    config.emit('eos-reconnect');
    await until(() => status.last?.state === 'connected', 'connected state');
    await until(() => eos.live().length === 1 && eos.live()[0].received.includes('/eos/subscribe'), 'subscribe message');
});

test('a press while connected replaces the connection with exactly one socket', async (t) => {
    const { eos, config, status, cues } = await setup(t);
    await eos.listen();
    config.emit('eos-reconnect');
    await until(() => status.last?.state === 'connected', 'first connection');

    for (let i = 0; i < 3; i++) {
        config.emit('eos-reconnect');
        await until(() => eos.conns.length === i + 2, `connection ${i + 2}`);
        await until(() => status.last?.state === 'connected' && eos.live().length === 1, 'single live connection');
    }
    assert.strictEqual(eos.live().length, 1);
    assert.ok(eos.live()[0].received.includes('/eos/subscribe'), 'new connection re-subscribed');

    // Cues flow over the new connection, once each (no duplicate handlers).
    eos.live()[0].socket.write(CUE_PACKET);
    await until(() => cues.includes('1899 B/O 3.0 100%'), 'cue after reconnect');
    assert.strictEqual(cues.filter((c) => c === '1899 B/O 3.0 100%').length, 1);
});

test('a half-sent packet on the old connection does not corrupt the new one', async (t) => {
    const { eos, config, status, cues } = await setup(t);
    await eos.listen();
    config.emit('eos-reconnect');
    await until(() => status.last?.state === 'connected', 'first connection');
    eos.live()[0].socket.write(CUE_PACKET.subarray(0, 20));
    await new Promise((r) => setTimeout(r, 100));

    config.emit('eos-reconnect');
    await until(() => eos.conns.length === 2 && status.last?.state === 'connected', 'second connection');
    eos.live()[0].socket.write(CUE_PACKET);
    await until(() => cues.includes('1899 B/O 3.0 100%'), 'clean cue on the new connection');
});

test('the console dropping shows as disconnected', async (t) => {
    const { eos, config, status } = await setup(t);
    await eos.listen();
    config.emit('eos-reconnect');
    await until(() => status.last?.state === 'connected', 'connected');
    eos.live()[0].socket.destroy();
    await until(() => status.last?.state === 'disconnected', 'disconnected state');
});

test('pressing during an attempt does not stack attempts', async (t) => {
    const { eos, config, status } = await setup(t);
    await eos.listen();
    config.emit('eos-reconnect');
    config.emit('eos-reconnect');
    config.emit('eos-reconnect');
    await until(() => status.last?.state === 'connected', 'connected');
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(eos.live().length, 1);
});
