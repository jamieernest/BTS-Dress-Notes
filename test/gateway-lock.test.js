const test = require('node:test');
const assert = require('node:assert');
const { createGatewayLock } = require('../gateway-lock');

const GROUP = '239.194.242.66';
const GATEWAY_CID = '1f447de3-9d68-328b-b0f6-4e567f884fa1';
const OTHER_CID = '0b4e1c9a-5d2f-4e6a-9c3b-7a8d9e0f1a2b';

// A show laptop on Wi-Fi, the venue LAN and a VPN that refuses multicast joins.
const INTERFACES = [
    { name: 'en0', address: '192.168.75.175', netmask: '255.255.255.0' },
    { name: 'en7', address: '10.10.160.50', netmask: '255.255.255.0' },
    { name: 'utun4', address: '100.64.0.2', netmask: '255.255.255.255' }
];

function setup({ interfaces = INTERFACES, lostMs = 10000 } = {}) {
    const calls = [];
    const logs = [];
    const socket = {
        addMembership(group, address) {
            if (address.startsWith('100.64.')) throw new Error('addMembership EADDRNOTAVAIL');
            calls.push(['add', group, address]);
        },
        dropMembership(group, address) {
            calls.push(['drop', group, address]);
        }
    };
    const clock = { time: 0, timers: [] };
    const env = { interfaces, changes: 0 };
    const lock = createGatewayLock({
        socket,
        group: GROUP,
        listInterfaces: () => env.interfaces,
        lostMs,
        log: (line) => logs.push(line),
        onChange: () => env.changes++,
        now: () => clock.time,
        setTimer: (fn, delay) => {
            const timer = { fn, at: clock.time + delay };
            clock.timers.push(timer);
            return timer;
        },
        clearTimer: (timer) => {
            clock.timers = clock.timers.filter(t => t !== timer);
        }
    });
    // Moves the clock forward, firing due timers in order.
    function advance(ms) {
        const end = clock.time + ms;
        for (;;) {
            const due = clock.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            clock.timers = clock.timers.filter(t => t !== due);
            clock.time = due.at;
            due.fn();
        }
        clock.time = end;
    }
    return { lock, calls, logs, env, advance };
}

test('joins on every interface and skips one that fails, logging it once', () => {
    const { lock, calls, logs, advance } = setup();
    assert.strictEqual(lock.start(), 2);
    assert.deepStrictEqual(calls, [['add', GROUP, '192.168.75.175'], ['add', GROUP, '10.10.160.50']]);
    assert.strictEqual(logs.filter(l => l.includes('utun4')).length, 1);
    assert.deepStrictEqual(lock.state().joined.map(i => i.name), ['en0', 'en7']);
    assert.strictEqual(lock.state().locked, false);

    advance(30000); // rescans while waiting retry the VPN quietly
    assert.strictEqual(logs.filter(l => l.includes('utun4')).length, 1);
});

test('start reports zero when no interface can be joined', () => {
    const { lock } = setup({ interfaces: [INTERFACES[2]] });
    assert.strictEqual(lock.start(), 0);
});

test('locks onto the first gateway heard and drops the other memberships', () => {
    const { lock, calls, env } = setup();
    lock.start();
    calls.length = 0;
    assert.strictEqual(lock.accept('10.10.160.188', GATEWAY_CID, false), false, 'a keepalive does not take the lock');
    assert.strictEqual(lock.accept('10.10.160.188', GATEWAY_CID, true), true);
    assert.deepStrictEqual(calls, [['drop', GROUP, '192.168.75.175']]);
    assert.deepStrictEqual(lock.state(), {
        locked: true,
        gateway: '10.10.160.188',
        gatewayCid: GATEWAY_CID,
        interfaceName: 'en7',
        interfaceAddress: '10.10.160.50',
        joined: [{ name: 'en7', address: '10.10.160.50' }]
    });
    assert.strictEqual(env.changes, 1);
});

test('ignores a second gateway once locked, by address or by CID', () => {
    const { lock, logs } = setup();
    lock.start();
    lock.accept('10.10.160.188', GATEWAY_CID, true);
    assert.strictEqual(lock.accept('192.168.75.20', OTHER_CID, true), false);
    assert.strictEqual(lock.accept('192.168.75.20', OTHER_CID, true), false);
    assert.strictEqual(lock.accept('10.10.160.188', OTHER_CID, true), false, 'same address, different CID');
    assert.strictEqual(lock.accept('10.10.160.188', GATEWAY_CID, true), true);
    assert.strictEqual(logs.filter(l => l.includes('ignoring MIDI from 192.168.75.20')).length, 1);
    assert.strictEqual(lock.state().gateway, '10.10.160.188');
});

test('keeps every membership for a gateway on no local subnet', () => {
    const { lock, calls } = setup();
    lock.start();
    calls.length = 0;
    assert.strictEqual(lock.accept('172.16.4.9', GATEWAY_CID, true), true);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(lock.state().interfaceAddress, null);
    assert.strictEqual(lock.state().joined.length, 2);
});

test('keepalives hold the lock; silence releases it and rejoins everywhere', () => {
    const { lock, calls, env, advance } = setup({ lostMs: 10000 });
    lock.start();
    lock.accept('10.10.160.188', GATEWAY_CID, true);
    advance(8000);
    lock.accept('10.10.160.188', GATEWAY_CID, false); // keepalive, timecode stopped
    advance(8000);
    assert.strictEqual(lock.state().locked, true);

    calls.length = 0;
    const changesBefore = env.changes;
    advance(3000); // 11 s since the last packet
    assert.strictEqual(lock.state().locked, false);
    assert.deepStrictEqual(calls, [['add', GROUP, '192.168.75.175']]);
    assert.deepStrictEqual(lock.state().joined.map(i => i.name), ['en7', 'en0']);
    assert.strictEqual(env.changes, changesBefore + 1);

    // A different gateway can now take the lock.
    assert.strictEqual(lock.accept('192.168.75.20', OTHER_CID, true), true);
    assert.strictEqual(lock.state().interfaceName, 'en0');
});

test('joins an interface that comes up while waiting for a gateway', () => {
    const { lock, calls, env, advance } = setup({ interfaces: [INTERFACES[0]] });
    lock.start();
    env.interfaces = INTERFACES.slice(0, 2);
    advance(10000);
    assert.deepStrictEqual(calls.map(c => c[2]), ['192.168.75.175', '10.10.160.50']);
    assert.strictEqual(env.changes, 1);
});

test('stop cancels the pending timer', () => {
    const { lock, advance, env } = setup({ interfaces: [INTERFACES[0]] });
    lock.start();
    lock.stop();
    env.interfaces = INTERFACES.slice(0, 2);
    advance(60000);
    assert.strictEqual(env.changes, 0);
});
