const test = require('node:test');
const assert = require('node:assert');
const { inSubnet, listIpv4Interfaces, resolveInterface } = require('../net-iface');

// Shape of os.networkInterfaces() on a show laptop with Wi-Fi and the venue LAN.
const OS_INTERFACES = {
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
    en0: [
        { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false },
        { address: '192.168.75.175', netmask: '255.255.255.0', family: 'IPv4', internal: false }
    ],
    en7: [{ address: '10.10.160.50', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
};

test('inSubnet compares the masked network part', () => {
    assert.strictEqual(inSubnet('10.10.160.188', '10.10.160.50', '255.255.255.0'), true);
    assert.strictEqual(inSubnet('10.10.161.188', '10.10.160.50', '255.255.255.0'), false);
    assert.strictEqual(inSubnet('10.10.161.188', '10.10.160.50', '255.255.0.0'), true);
    assert.strictEqual(inSubnet('not-an-ip', '10.10.160.50', '255.255.255.0'), false);
});

test('listIpv4Interfaces keeps external IPv4 addresses only', () => {
    assert.deepStrictEqual(listIpv4Interfaces(OS_INTERFACES), [
        { name: 'en0', address: '192.168.75.175', netmask: '255.255.255.0' },
        { name: 'en7', address: '10.10.160.50', netmask: '255.255.255.0' }
    ]);
});

test('an explicit address is used even when no interface has it', () => {
    const interfaces = listIpv4Interfaces(OS_INTERFACES);
    const selected = resolveInterface('192.168.75.175', interfaces);
    assert.strictEqual(selected.address, '192.168.75.175');
    assert.match(selected.reason, /en0/);
    const missing = resolveInterface('10.0.0.1', interfaces);
    assert.strictEqual(missing.address, '10.0.0.1');
    assert.match(missing.reason, /no interface/);
});
