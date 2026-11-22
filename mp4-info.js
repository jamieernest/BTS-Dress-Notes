// How long an MP4/MOV file runs, read from its `moov`/`mvhd` box without
// decoding anything (OBS records with no ffprobe to hand).
//
// Boxes are `size(4) type(4)`, with a 64-bit size after the type when size is
// 1 and "to the end of the file" when it is 0. A recording OBS is still
// writing has no `moov` yet, which readMp4Info() reports as unfinished so the
// caller tries again later; a fragmented MP4 has one with a zero duration.

const fs = require('node:fs');

const MAX_BOXES = 256;

function readAt(fd, position, length) {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, position);
    return read === length ? buffer : null;
}

// The box at `position`: { type, start, headerSize, end } or null.
function boxAt(fd, position, limit) {
    if (position + 8 > limit) return null;
    const head = readAt(fd, position, 8);
    if (!head) return null;
    let size = head.readUInt32BE(0);
    let headerSize = 8;
    if (size === 1) {
        const big = readAt(fd, position + 8, 8);
        if (!big) return null;
        size = Number(big.readBigUInt64BE(0));
        headerSize = 16;
    } else if (size === 0) {
        size = limit - position;
    }
    if (size < headerSize || position + size > limit) return null;
    return { type: head.toString('latin1', 4, 8), start: position, headerSize, end: position + size };
}

// The first child of `parent` (or of the whole file) with this type.
function findBox(fd, type, from, limit) {
    let position = from;
    for (let i = 0; i < MAX_BOXES; i++) {
        const box = boxAt(fd, position, limit);
        if (!box) return null;
        if (box.type === type) return box;
        position = box.end;
    }
    return null;
}

// { durationS } for a finished file, { noDuration: true } when it says none
// (fragmented), { unfinished: true } when it has no `moov` yet, or
// { unreadable: true } when it is not an MP4 at all.
function readMp4Info(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const limit = fs.fstatSync(fd).size;
        const first = boxAt(fd, 0, limit);
        if (!first || !/^[a-z0-9 ]{4}$/i.test(first.type)) return { unreadable: true };
        const moov = findBox(fd, 'moov', 0, limit);
        if (!moov) return { unfinished: true };
        const mvhd = findBox(fd, 'mvhd', moov.start + moov.headerSize, moov.end);
        if (!mvhd) return { unfinished: true };
        const body = readAt(fd, mvhd.start + mvhd.headerSize, 32);
        if (!body) return { unfinished: true };
        const version = body[0];
        const timescale = version === 1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
        const duration = version === 1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
        if (!timescale || !duration) return { noDuration: true };
        return { durationS: duration / timescale };
    } catch (error) {
        return { unreadable: true };
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

module.exports = { readMp4Info };
