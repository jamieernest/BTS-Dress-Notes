const test = require('node:test');
const assert = require('node:assert');
const { extractMidi, wrapperSequence, createSequenceFilter, senderCid } = require('../acn-midi');
const { createMtcDecoder } = require('../mtc');

// UDP payloads captured from the ETC Response MIDI gateway (10.10.160.188 ->
// 239.194.242.66:5568) while QLab ran MTC from 08:30:00:00 at 30 fps.
const GATEWAY_CID = '1f447de3-9d68-328b-b0f6-4e567f884fa1';
// Unreliable wrapper, one DMP client block carrying quarter-frame F1 00.
const QF_PIECE_0 = Buffer.from('001000004153432d45312e31370000007044000000011f447de39d68328bb0f64e567f884fa1702e0200010000f03a0000000d0000000dffffffff00007017ffff000000020000700d020002000800000001f100', 'hex');
// Wrapper holding two client blocks: an SDT ACK of the desk's channel, then F1 51.
const ACK_AND_QF = Buffer.from('001000004153432d45312e31370000007055000000011f447de39d68328bb0f64e567f884fa1703f0200010000f0ff0000000d0000000dffffffff00007011000100000001ed4670070e0000ed477017ffff000000020000700d020002000800000001f151', 'hex');
// Empty wrapper asking member 1 to ACK - no client block, no MIDI.
const KEEPALIVE = Buffer.from('001000004153432d45312e3137000000702d000000011f447de39d68328bb0f64e567f884fa170170200010000f0350000000b0000000b000100010000', 'hex');
// Reliable wrapper carrying MSC SysEx: GO cue 1801 in list 1.
const MSC_GO_1801 = Buffer.from('001000004153432d45312e3137000000704f000000011f447de39d68328bb0f64e567f884fa170390100010000f0390000000d0000000dffffffff00007022ffff0000000200007018020002001300000001f07f00027f01313830310031f7', 'hex');
// sACN universe discovery from ETCNomad on the same port - must be ignored.
const SACN_DISCOVERY = Buffer.from('001000004153432d45312e3137000000706c00000008c9fb55dd4a3a40d785d93e809b1e58387056000000024554434e6f6d6164000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000700c00000001000000010002', 'hex');

// The eight consecutive quarter-frame packets that open the capture differ only
// in the SDT total sequence number (offset 46) and the MIDI data byte (offset 83).
function quarterFramePacket(seq, dataByte) {
    const packet = Buffer.from(QF_PIECE_0);
    packet[46] = seq;
    packet[83] = dataByte;
    return packet;
}
const FIRST_SEQUENCE = [0x00, 0x10, 0x20, 0x30, 0x4e, 0x51, 0x68, 0x76]
    .map((dataByte, i) => quarterFramePacket(0x3a + i, dataByte));

function hexMessages(buf) {
    return extractMidi(buf).map(midi => midi.toString('hex'));
}

test('extracts the quarter-frame from a plain quarter-frame packet', () => {
    assert.deepStrictEqual(hexMessages(QF_PIECE_0), ['f100']);
    assert.strictEqual(senderCid(QF_PIECE_0), GATEWAY_CID);
});

test('walks past an SDT ACK client block to the quarter-frame after it', () => {
    assert.deepStrictEqual(hexMessages(ACK_AND_QF), ['f151']);
});

test('a keepalive carries no MIDI', () => {
    assert.deepStrictEqual(hexMessages(KEEPALIVE), []);
});

test('extracts MSC SysEx from a reliable wrapper', () => {
    assert.deepStrictEqual(hexMessages(MSC_GO_1801), ['f07f00027f01313830310031f7']);
});

test('ignores sACN and non-ACN traffic on port 5568', () => {
    assert.deepStrictEqual(hexMessages(SACN_DISCOVERY), []);
    assert.deepStrictEqual(hexMessages(Buffer.from('not an ACN packet')), []);
    assert.deepStrictEqual(hexMessages(QF_PIECE_0.subarray(0, 60)), []);
});

function decodeAll(packets) {
    const timecodes = [];
    const decoder = createMtcDecoder('network', tc => timecodes.push(tc));
    for (const packet of packets) {
        for (const midi of extractMidi(packet)) {
            if (midi[0] === 0xF1) decoder.quarterFrame(midi[1] >> 4, midi[1] & 0x0F);
        }
    }
    return { decoder, timecodes };
}

test('the captured quarter-frame sequence decodes to 08:30:00:00 at 30 fps', () => {
    const { timecodes } = decodeAll(FIRST_SEQUENCE);
    assert.deepStrictEqual(timecodes, [
        { hours: 8, minutes: 30, seconds: 0, frames: 0, frameRate: 30, source: 'network' }
    ]);
});

test('no timecode is emitted until all eight pieces have arrived', () => {
    // Joining mid-sequence: pieces 4-7 alone must not produce a timecode.
    const { decoder, timecodes } = decodeAll(FIRST_SEQUENCE.slice(4));
    assert.deepStrictEqual(timecodes, []);

    // After a reset (stream stopped), a partial sequence is not emitted either.
    for (const packet of FIRST_SEQUENCE) {
        const [midi] = extractMidi(packet);
        decoder.quarterFrame(midi[1] >> 4, midi[1] & 0x0F);
    }
    assert.strictEqual(timecodes.length, 1);
    decoder.reset();
    decoder.quarterFrame(7, 0x6);
    assert.strictEqual(timecodes.length, 1);
});

test('decodes full-frame MTC SysEx and rejects other SysEx', () => {
    const timecodes = [];
    const decoder = createMtcDecoder('network', tc => timecodes.push(tc));
    // F0 7F 7F 01 01 hh mm ss ff F7 with hh = 0rrhhhhh: rate 3 (30 fps), hour 8.
    assert.strictEqual(decoder.fullFrame(Buffer.from('f07f7f0101681e0c05f7', 'hex')), true);
    assert.deepStrictEqual(timecodes, [
        { hours: 8, minutes: 30, seconds: 12, frames: 5, frameRate: 30, source: 'network' }
    ]);
    assert.strictEqual(decoder.fullFrame(extractMidi(MSC_GO_1801)[0]), false);
    assert.strictEqual(timecodes.length, 1);
});

test('reads the SDT total sequence number and drops duplicate copies', () => {
    assert.strictEqual(wrapperSequence(QF_PIECE_0), 0xf03a);
    assert.strictEqual(wrapperSequence(ACK_AND_QF), 0xf0ff);
    assert.strictEqual(wrapperSequence(SACN_DISCOVERY), null);

    const isNew = createSequenceFilter();
    assert.strictEqual(isNew(0xf03a), true);
    assert.strictEqual(isNew(0xf03a), false); // the same packet delivered twice
    assert.strictEqual(isNew(0xf03b), true);
    assert.strictEqual(isNew(0xf03a), false); // a late copy of an older packet
    assert.strictEqual(isNew(0x1b27), true); // gateway restarted and reset its sequence
    assert.strictEqual(isNew(0xffffffff), true);
    assert.strictEqual(isNew(0), true); // wraparound
});
