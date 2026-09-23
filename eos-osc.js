// Helpers for OSC traffic from an ETC Eos desk.
//
// The TCP connection (Eos port 3037) uses OSC 1.1 SLIP framing: every packet
// is wrapped in END (0xC0) bytes, and a single socket 'data' chunk can hold
// several packets or only part of one.
const { decode } = require('node-osc');

const SLIP_END = 0xc0;
const SLIP_ESC = 0xdb;
const SLIP_ESC_END = 0xdc;
const SLIP_ESC_ESC = 0xdd;

// Returns a function that accepts raw TCP chunks and calls onPacket with each
// complete, unescaped OSC packet, buffering partial packets across chunks.
function createSlipDecoder(onPacket) {
    let bytes = [];
    let escaped = false;
    return function push(chunk) {
        for (const byte of chunk) {
            if (escaped) {
                escaped = false;
                if (byte === SLIP_ESC_END) bytes.push(SLIP_END);
                else if (byte === SLIP_ESC_ESC) bytes.push(SLIP_ESC);
                else bytes.push(byte);
            } else if (byte === SLIP_ESC) {
                escaped = true;
            } else if (byte === SLIP_END) {
                if (bytes.length > 0) onPacket(Buffer.from(bytes));
                bytes = [];
            } else {
                bytes.push(byte);
            }
        }
    };
}

// Decodes an OSC packet into a list of [address, ...values] messages,
// flattening bundles. Returns an empty list for undecodable packets.
function decodeOscPacket(packet) {
    let decoded;
    try {
        decoded = decode(packet);
    } catch (e) {
        return [];
    }
    const messages = [];
    (function collect(node) {
        if (node.oscType === 'bundle') {
            node.elements.forEach(collect);
        } else if (node.oscType === 'message') {
            messages.push([node.address, ...node.args.map(arg => arg.value)]);
        }
    })(decoded);
    return messages;
}

// Eos cue text is "<list>/<label> <time> [<percent>]", e.g. "1/1899 B/O 3.0 100%".
// Only the cue list prefix is dropped; the label may itself contain '/'.
function extractCueLabel(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(/^[^/]*\/(.+)$/s);
    const label = match ? match[1].trim() : '';
    return label || null;
}

module.exports = { createSlipDecoder, decodeOscPacket, extractCueLabel };
