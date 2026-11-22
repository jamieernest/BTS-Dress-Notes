// Runs the real server against two stand-in consoles (loopback addresses
// 127.0.0.1 and another local address) and checks that choosing a venue or a custom
// address reconnects to it, and that venues and the choice survive a restart.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { until, freePort, startOidc, createApp, login, Browser } = require('./e2e-harness');

function createConsole(host, port) {
    const conns = [];
    const server = net.createServer((socket) => {
        const conn = { socket, received: Buffer.alloc(0), closed: false };
        socket.on('data', (d) => { conn.received = Buffer.concat([conn.received, d]); });
        socket.on('close', () => { conn.closed = true; });
        socket.on('error', () => {});
        conns.push(conn);
    });
    return {
        live: () => conns.filter((c) => !c.closed),
        listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }),
        close: () => new Promise((resolve) => { conns.forEach((c) => c.socket.destroy()); server.close(resolve); })
    };
}

const ack = (socket, event, data) => new Promise((resolve) => socket.emit(event, data, resolve));

async function setup(t) {
    const oidc = await startOidc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-venues-e2e-'));
    const eosPort = await freePort();
    const one = createConsole('127.0.0.1', eosPort);
    // A second local address: 127.0.0.2 on Linux, else this machine's own LAN address (macOS has no 127.0.0.2).
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
    let two = null;
    await one.listen();
    for (const host of ['127.0.0.2', lan].filter(Boolean)) {
        const candidate = createConsole(host, eosPort);
        try { await candidate.listen(); two = candidate; two.host = host; break; } catch (e) { /* try the next */ }
    }
    if (!two) { t.skip('no second local IPv4 address'); await one.close(); oidc.close(); return null; }
    const otherHost = two.host;
    const settingsFile = path.join(dir, 'local-settings.json');
    const app = createApp({ issuer: oidc.issuer, sessionsFile: path.join(dir, 'sessions.json'), port: await freePort(),
        env: { EOS_PORT: String(eosPort), SETTINGS_FILE: settingsFile } });
    await app.start();
    const cookie = await login(app, oidc, 'alice');
    let config = Browser.configSocket(app, cookie);
    const state = { status: null, cfg: null };
    const watch = (s) => { s.on('eos-status', (x) => { state.status = { ...x }; }); s.on('eos-config', (c) => { state.cfg = c; }); };
    watch(config);
    t.after(async () => {
        config.close();
        await one.close(); await two.close();
        await app.stop().catch(() => {});
        oidc.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    await until(() => state.status?.state === 'connected', 'connected to the default address');
    return { otherHost, app, oidc, one, two, state, settingsFile, cookie, watch, get config() { return config; }, set config(c) { config = c; } };
}

test('choosing a venue or a custom address reconnects to it; the default is EOS_HOST', async (t) => {
    const ctx = await setup(t);
    if (!ctx) return;
    const { one, two, state, otherHost } = ctx;
    const { config } = ctx;
    assert.strictEqual(state.status.host, '127.0.0.1');
    assert.strictEqual(state.cfg.choice, null);
    assert.strictEqual(one.live().length, 1);

    const added = await ack(config, 'eos-venue-save', { name: 'Second Hall', host: otherHost });
    assert.ok(added.venue.id);
    // Adding a venue alone does not change the connection.
    assert.strictEqual(state.status.host, '127.0.0.1');

    assert.match((await ack(config, 'eos-venue-save', { name: 'second hall', host: '127.0.0.3' })).error, /already exists/);
    assert.match((await ack(config, 'eos-venue-save', { name: 'Bad', host: '300.0.0.1' })).error, /IPv4/);
    assert.match((await ack(config, 'eos-select', { host: 'not-an-ip' })).error, /IPv4/);

    assert.deepStrictEqual(await ack(config, 'eos-select', { venue: added.venue.id }), {});
    await until(() => state.status.host === otherHost && state.status.state === 'connected', 'connected to the venue');
    await until(() => two.live().length === 1 && two.live()[0].received.includes('/eos/subscribe'), 'subscribe on the new console');
    await until(() => one.live().length === 0, 'old connection closed');

    // The venue in use cannot be deleted.
    assert.match((await ack(config, 'eos-venue-delete', added.venue.id)).error, /in use/);

    await ack(config, 'eos-select', { host: '127.0.0.1' });
    await until(() => state.status.host === '127.0.0.1' && state.status.state === 'connected' && one.live().length === 1, 'custom address');
    await until(() => two.live().length === 0, 'second console released');

    await ack(config, 'eos-select', null);
    assert.strictEqual(state.cfg.choice, null);
    assert.deepStrictEqual(await ack(config, 'eos-venue-delete', added.venue.id), {});
    assert.strictEqual(state.cfg.venues.length, 0);
});

test('venues and the choice survive a restart', async (t) => {
    const ctx = await setup(t);
    if (!ctx) return;
    const { app, two, state, settingsFile, watch, config, otherHost } = ctx;
    const added = await ack(config, 'eos-venue-save', { name: 'Second Hall', host: otherHost });
    await ack(config, 'eos-select', { venue: added.venue.id });
    await until(() => state.status.host === otherHost && state.status.state === 'connected', 'switched');
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).eosChoice.venue, added.venue.id);

    config.close();
    await app.stop();
    await app.start();
    const again = Browser.configSocket(app, ctx.cookie);
    ctx.config = again;
    state.status = null; state.cfg = null;
    watch(again);
    await until(() => state.cfg && state.status?.state === 'connected', 'reconnected after restart');
    assert.strictEqual(state.status.host, otherHost);
    assert.deepStrictEqual(state.cfg.venues.map((v) => v.name), ['Second Hall']);
    assert.strictEqual(two.live().length >= 1, true);
    again.close();
});
