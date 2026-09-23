// MIDI Timecode decoding, shared by every timecode source (MIDI input and
// the network gateway). One decoder per source keeps their quarter-frames apart.

const frameRates = {
    0: 24,
    1: 25,
    2: 29.97,
    3: 30
};

// Decodes the hours byte shared by quarter-frame piece 6/7 and full-frame
// messages: 0rrhhhhh, rr = rate code.
function decodeHoursAndRate(hoursAndRate) {
    return {
        hours: hoursAndRate & 0x1F,
        frameRate: frameRates[(hoursAndRate >> 5) & 0x03] || 30
    };
}

// onTimecode(tc) fires whenever a complete timecode differs from the last one.
function createMtcDecoder(source, onTimecode) {
    const quarterFrameData = new Array(8).fill(0);
    let piecesSeen = 0; // bitmask; a timecode is only emitted once all 8 pieces have arrived
    let lastFullTimecode = null;

    function emit(hours, minutes, seconds, frames, frameRate) {
        const newTimecode = { hours, minutes, seconds, frames, frameRate, source };
        if (!lastFullTimecode ||
            lastFullTimecode.hours !== newTimecode.hours ||
            lastFullTimecode.minutes !== newTimecode.minutes ||
            lastFullTimecode.seconds !== newTimecode.seconds ||
            lastFullTimecode.frames !== newTimecode.frames) {
            lastFullTimecode = { ...newTimecode };
            onTimecode(newTimecode);
        }
    }

    return {
        // piece = data byte >> 4 (0-7), nibble = data byte & 0x0F
        quarterFrame(piece, nibble) {
            quarterFrameData[piece] = nibble;
            piecesSeen |= 1 << piece;
            if (piece === 7 && piecesSeen === 0xFF) {
                const { hours, frameRate } = decodeHoursAndRate((quarterFrameData[7] << 4) | quarterFrameData[6]);
                emit(
                    hours,
                    (quarterFrameData[5] << 4) | quarterFrameData[4],
                    (quarterFrameData[3] << 4) | quarterFrameData[2],
                    (quarterFrameData[1] << 4) | quarterFrameData[0],
                    frameRate
                );
            }
        },

        // Full-frame SysEx: F0 7F <device> 01 01 hh mm ss ff F7. Returns false
        // for any other message.
        fullFrame(bytes) {
            if (bytes.length < 10 || bytes[0] !== 0xF0 || bytes[1] !== 0x7F ||
                bytes[3] !== 0x01 || bytes[4] !== 0x01 || bytes[9] !== 0xF7) {
                return false;
            }
            const { hours, frameRate } = decodeHoursAndRate(bytes[5]);
            emit(hours, bytes[6], bytes[7], bytes[8], frameRate);
            return true;
        },

        // Forget a partial quarter-frame sequence, e.g. after the stream stops,
        // so the next run is never assembled from stale pieces.
        reset() {
            quarterFrameData.fill(0);
            piecesSeen = 0;
            lastFullTimecode = null;
        }
    };
}

module.exports = { createMtcDecoder };
