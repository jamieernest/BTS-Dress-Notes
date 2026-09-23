const test = require('node:test');
const assert = require('node:assert');
const { createSlipDecoder, decodeOscPacket, extractCueLabel } = require('../eos-osc');

// Raw TCP 'data' chunks captured from a real Eos desk on port 3037 (SLIP framed).
const ACTIVE_1899 = Buffer.from('c02f656f732f6f75742f6163746976652f6375652f74657874000000002c730000312f3138393920422f4f20332e30203130302500c0', 'hex');
const PENDING_1900 = Buffer.from('c02f656f732f6f75742f70656e64696e672f6375652f746578740000002c730000312f3139303020422f4f20302e300000c0', 'hex');
// One chunk that carried two packets.
const COALESCED_SOFTKEYS = Buffer.from('c02f656f732f6f75742f736f66746b65792f3300002c730000536e617073686f7400000000c0c02f656f732f6f75742f736f66746b65792f3700002c7300005072657669657700c0', 'hex');
// Chunks where the active cue text came after other packets; the old
// startsWith check dropped these cue changes entirely.
const COALESCED_1899_GO = Buffer.from('c02f656f732f6f75742f6163746976652f637565002c66000000000000c0c02f656f732f6f75742f6163746976652f6375652f74657874000000002c730000312f3138393920422f4f20332e30203025000000c0', 'hex');
const COALESCED_2109_GO = Buffer.from('c02f656f732f6f75742f757365722f302f636d64002c7369004c4956453a20437565202032313039203a20000000000000c0c02f656f732f6f75742f757365722f312f636d64002c7369004c4956453a20437565202032313039203a20476f20546f2043756520323130392023000000000000c0c02f656f732f6f75742f636d64000000002c7369004c4956453a20437565202032313039203a20476f20546f2043756520323130392023000000000000c0c02f656f732f6f75742f70726576696f75732f6375652f312f32313038000000002c000000c0c02f656f732f6f75742f70726576696f75732f6375652f7465787400002c730000312f323130382070696e67203420302e38000000c0c02f656f732f6f75742f6163746976652f6375652f312f3231303900002c66000000000000c0c02f656f732f6f75742f6163746976652f637565002c66000000000000c0c02f656f732f6f75742f6163746976652f6375652f74657874000000002c730000312f32313039207265736574202d2069204a55535420646f6e7420756e6465727374616e6420372e3520302500000000c0c02f656f732f6f75742f70656e64696e672f6375652f312f32313130002c000000c0c02f656f732f6f75742f70656e64696e672f6375652f746578740000002c730000312f323131302063686f72757320322e33000000c0', 'hex');

function activeCueLabels(chunks) {
    return collect(chunks)
        .filter(([address]) => address === '/eos/out/active/cue/text')
        .map(([, text]) => extractCueLabel(text));
}

function collect(chunks) {
    const messages = [];
    const push = createSlipDecoder(packet => messages.push(...decodeOscPacket(packet)));
    chunks.forEach(push);
    return messages;
}

test('extractCueLabel keeps slashes, time and percentage in the label', () => {
    assert.strictEqual(extractCueLabel('1/1899 B/O 3.0 100%'), '1899 B/O 3.0 100%');
    assert.strictEqual(extractCueLabel('1/199 B/O 1.0 2%'), '199 B/O 1.0 2%');
    assert.strictEqual(extractCueLabel('1/1814 back to centre 3.0'), '1814 back to centre 3.0');
    assert.strictEqual(extractCueLabel('1/1802 Dancers spread out (2nd 4 bar count) 2.0 45%'), '1802 Dancers spread out (2nd 4 bar count) 2.0 45%');
    // Eos sends empty text when no cue is active.
    assert.strictEqual(extractCueLabel(''), null);
    assert.strictEqual(extractCueLabel('1/'), null);
    assert.strictEqual(extractCueLabel(undefined), null);
});

test('decodes a captured active cue packet with a slash in its label', () => {
    const messages = collect([ACTIVE_1899]);
    assert.deepStrictEqual(messages, [['/eos/out/active/cue/text', '1/1899 B/O 3.0 100%']]);
    assert.strictEqual(extractCueLabel(messages[0][1]), '1899 B/O 3.0 100%');
});

test('splits a chunk holding several SLIP packets', () => {
    assert.deepStrictEqual(collect([COALESCED_SOFTKEYS]), [
        ['/eos/out/softkey/3', 'Snapshot'],
        ['/eos/out/softkey/7', 'Preview'],
    ]);
});

test('finds active cue text coalesced behind other packets', () => {
    assert.deepStrictEqual(activeCueLabels([COALESCED_1899_GO]), ['1899 B/O 3.0 0%']);
    assert.deepStrictEqual(activeCueLabels([COALESCED_2109_GO]), ['2109 reset - i JUST dont understand 7.5 0%']);
    assert.strictEqual(collect([COALESCED_2109_GO]).length, 10);
});

test('reassembles packets split across chunks', () => {
    const stream = Buffer.concat([ACTIVE_1899, PENDING_1900]);
    const chunks = [];
    for (let i = 0; i < stream.length; i += 7) chunks.push(stream.subarray(i, i + 7));
    assert.deepStrictEqual(collect(chunks), [
        ['/eos/out/active/cue/text', '1/1899 B/O 3.0 100%'],
        ['/eos/out/pending/cue/text', '1/1900 B/O 0.0'],
    ]);
});

test('unescapes SLIP escape sequences', () => {
    const packets = [];
    const push = createSlipDecoder(packet => packets.push(packet));
    push(Buffer.from([0xc0, 0x01, 0xdb, 0xdc, 0x02, 0xdb, 0xdd, 0x03, 0xc0]));
    assert.deepStrictEqual(packets, [Buffer.from([0x01, 0xc0, 0x02, 0xdb, 0x03])]);
});

test('ignores undecodable packets', () => {
    assert.deepStrictEqual(collect([Buffer.from([0xc0, 0x01, 0x02, 0xc0])]), []);
});
