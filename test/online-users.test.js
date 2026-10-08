const test = require('node:test');
const assert = require('node:assert');
const { deviceLabel, groupUsers, deviceIdOf } = require('../online-users');

const UA = {
    chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

test('deviceLabel names the browser and operating system', () => {
    assert.strictEqual(deviceLabel(UA.chromeWin), 'Chrome, Windows');
    assert.strictEqual(deviceLabel(UA.edgeWin), 'Edge, Windows');
    assert.strictEqual(deviceLabel(UA.firefoxLinux), 'Firefox, Linux');
    assert.strictEqual(deviceLabel(UA.safariMac), 'Safari, macOS');
    assert.strictEqual(deviceLabel(UA.safariIphone), 'Safari, iOS');
    assert.strictEqual(deviceLabel(UA.chromeIphone), 'Chrome, iOS');
    assert.strictEqual(deviceLabel(UA.chromeAndroid), 'Chrome, Android');
    assert.strictEqual(deviceLabel(UA.samsung), 'Samsung Internet, Android');
    assert.strictEqual(deviceLabel(UA.chromeOs), 'Chrome, ChromeOS');
});

test('deviceLabel copes with a missing or unknown User-Agent', () => {
    assert.strictEqual(deviceLabel(undefined), 'Unknown device');
    assert.strictEqual(deviceLabel('curl/8.0'), 'Unknown device');
    assert.strictEqual(deviceLabel('Chrome/1'), 'Chrome');
});

const sock = (id, name, deviceId, extra = {}) => ({ id, name, deviceId, deviceLabel: `label-${deviceId}`, isTyping: false, ...extra });

test('sockets of one device (tabs) are one device of one person', () => {
    const [bob, ...rest] = groupUsers([sock('b', 'Bob', 'd1'), sock('b', 'Bob', 'd1')]);
    assert.strictEqual(rest.length, 0);
    assert.deepStrictEqual(bob.devices, [{ id: 'd1', label: 'label-d1', isTyping: false }]);
});

test('a person on two devices is one entry with two devices, in connection order', () => {
    const list = groupUsers([sock('b', 'Bob', 'd1'), sock('a', 'Alice', 'd9'), sock('b', 'Bob', 'd2')]);
    assert.deepStrictEqual(list.map((u) => u.name), ['Bob', 'Alice']);
    assert.deepStrictEqual(list[0].devices.map((d) => d.label), ['label-d1', 'label-d2']);
    assert.strictEqual('deviceId' in list[0], false);
});

test('typing shows on the person and on the device that is typing', () => {
    const [bob] = groupUsers([sock('b', 'Bob', 'd1'), sock('b', 'Bob', 'd1', { isTyping: true }), sock('b', 'Bob', 'd2')]);
    assert.strictEqual(bob.isTyping, true);
    assert.deepStrictEqual(bob.devices.map((d) => d.isTyping), [true, false]);
});

test('overlay and config sockets are left out', () => {
    const list = groupUsers([sock('b', 'Bob', 'd1', { isOverlay: true }), sock('b', 'Bob', 'd2', { isConfig: true })]);
    assert.deepStrictEqual(list, []);
});

test('deviceIdOf uses a sane id from the handshake, else one per socket', () => {
    const make = (auth) => ({ id: 'sid', handshake: { auth } });
    assert.strictEqual(deviceIdOf(make({ deviceId: 'abcd-1234-efgh' })), 'abcd-1234-efgh');
    assert.strictEqual(deviceIdOf(make({})), 'socket-sid');
    assert.strictEqual(deviceIdOf(make(undefined)), 'socket-sid');
    assert.strictEqual(deviceIdOf(make({ deviceId: '<script>' })), 'socket-sid');
    assert.strictEqual(deviceIdOf(make({ deviceId: 'x'.repeat(200) })), 'socket-sid');
});
