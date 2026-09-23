// ETC Response MIDI gateway: MIDI carried over ANSI E1.17 (ACN) SDT multicast.
//
// The gateway sends every MIDI message it receives as a DMP SET_PROPERTY on
// property address 0x02, inside an SDT wrapper (reliable or unreliable):
//   ACN preamble -> root PDU (vector 1 = SDT, CID) -> SDT wrapper
//     -> client block(s) (protocol 2 = DMP) -> DMP PDU
//     -> value: [u16 length incl. itself][u32 = 1][raw MIDI bytes]
// A wrapper can hold several client blocks (e.g. an SDT ACK plus the MIDI one),
// and keepalive wrappers hold none.

const ACN_PACKET_ID = Buffer.from('ASC-E1.17\0\0\0', 'latin1');
const ROOT_VECTOR_SDT = 1;
const SDT_RELIABLE_WRAPPER = 1;
const SDT_UNRELIABLE_WRAPPER = 2;
const CLIENT_PROTOCOL_DMP = 2;
const DMP_SET_PROPERTY = 2;
const MIDI_PROPERTY_ADDRESS = 2;

// Yields [start, end) of each PDU in buf[start, end). Only flags 0x7 (vector,
// header and data present, 12-bit length) are handled - the gateway uses no other.
function* pdus(buf, start, end) {
    let i = start;
    while (i + 2 <= end) {
        const len = ((buf[i] & 0x0f) << 8) | buf[i + 1];
        if (len < 3 || i + len > end) return;
        if (buf[i] >> 4 === 0x7) yield [i, i + len];
        i += len;
    }
}

function isAcnPacket(buf) {
    return buf.length >= 38 && buf.readUInt16BE(0) === 0x0010 && buf.subarray(4, 16).equals(ACN_PACKET_ID);
}

// Returns the raw MIDI messages carried in one UDP payload (empty for
// keepalives, ACKs, sACN and anything else that isn't gateway MIDI).
function extractMidi(buf) {
    const messages = [];
    if (!isAcnPacket(buf)) return messages;
    for (const [r, rEnd] of pdus(buf, 16, buf.length)) {
        if (r + 22 > rEnd || buf.readUInt32BE(r + 2) !== ROOT_VECTOR_SDT) continue;
        for (const [w, wEnd] of pdus(buf, r + 22, rEnd)) { // r+6..r+21 = CID
            if (buf[w + 2] !== SDT_RELIABLE_WRAPPER && buf[w + 2] !== SDT_UNRELIABLE_WRAPPER) continue;
            for (const [c, cEnd] of pdus(buf, w + 23, wEnd)) {
                if (c + 10 > cEnd || buf.readUInt32BE(c + 4) !== CLIENT_PROTOCOL_DMP) continue;
                for (const [d, dEnd] of pdus(buf, c + 10, cEnd)) {
                    // SET_PROPERTY, absolute single 1-byte address, address 0x02
                    if (d + 7 > dEnd || buf[d + 2] !== DMP_SET_PROPERTY || buf[d + 3] !== 0x00 ||
                        buf[d + 4] !== MIDI_PROPERTY_ADDRESS) continue;
                    const valueLength = buf.readUInt16BE(d + 5); // includes itself
                    if (valueLength < 7 || d + 5 + valueLength > dEnd) continue;
                    messages.push(buf.subarray(d + 11, d + 5 + valueLength)); // skip the u32
                }
            }
        }
    }
    return messages;
}

// SDT total sequence number of the first wrapper (it rises by one on every
// packet the gateway sends), or null if the packet has no SDT wrapper.
function wrapperSequence(buf) {
    if (!isAcnPacket(buf)) return null;
    for (const [r, rEnd] of pdus(buf, 16, buf.length)) {
        if (r + 22 > rEnd || buf.readUInt32BE(r + 2) !== ROOT_VECTOR_SDT) continue;
        for (const [w, wEnd] of pdus(buf, r + 22, rEnd)) {
            if (w + 9 > wEnd) continue;
            if (buf[w + 2] === SDT_RELIABLE_WRAPPER || buf[w + 2] === SDT_UNRELIABLE_WRAPPER) {
                return buf.readUInt32BE(w + 5);
            }
        }
    }
    return null;
}

// Drops packets already seen: some networks (e.g. Wi-Fi) deliver every
// multicast packet twice, and a late copy could mix quarter-frames from two
// sequences. A large backwards jump is accepted as the gateway restarting.
const REORDER_WINDOW = 256;
function createSequenceFilter() {
    let last = null;
    return function isNew(seq) {
        if (seq === null) return true;
        if (last !== null && (seq === last || ((last - seq) >>> 0) < REORDER_WINDOW)) return false;
        last = seq;
        return true;
    };
}

// Sender CID of the first root PDU, as a UUID string (null if not ACN).
function senderCid(buf) {
    if (!isAcnPacket(buf)) return null;
    const hex = buf.subarray(22, 38).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = { extractMidi, wrapperSequence, createSequenceFilter, senderCid };
