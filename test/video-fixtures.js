// Tiny MP4 files for the tests: just the boxes obs-pickup.js reads (ftyp, mdat
// and a moov holding an mvhd), not playable video.
const box = (type, ...parts) => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
};

function mvhd({ durationS, timescale = 1000, version = 0 }) {
    const body = Buffer.alloc(version === 1 ? 32 : 20);
    body[0] = version;
    if (version === 1) {
        body.writeUInt32BE(timescale, 20);
        body.writeBigUInt64BE(BigInt(Math.round(durationS * timescale)), 24);
    } else {
        body.writeUInt32BE(timescale, 12);
        body.writeUInt32BE(Math.round(durationS * timescale), 16);
    }
    return box('mvhd', body, Buffer.alloc(80));
}

// A finished file (`moov` after the media, as OBS writes it), or with
// `unfinished` one still being written (no `moov`), or `fragmented` (a `moov`
// that says no length).
function makeMp4({ durationS = 12, unfinished = false, fragmented = false, version = 0, moovFirst = false } = {}) {
    const ftyp = box('ftyp', Buffer.from('isom\0\0\2\0isomiso2mp41', 'latin1'));
    const mdat = box('mdat', Buffer.alloc(2048, 7));
    if (unfinished) return Buffer.concat([ftyp, mdat]);
    const moov = box('moov', mvhd({ durationS: fragmented ? 0 : durationS, version }));
    return Buffer.concat(moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}

module.exports = { makeMp4 };
