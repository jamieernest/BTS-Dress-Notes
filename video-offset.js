// The per-install video offset (VIDEO_OFFSET_S): a fixed number of seconds
// added to every OBS recording's start time as it is added to the live notes
// (obs-pickup.js), for whatever lag is left after the recorder has asked OBS
// how long it had been recording (obs-recorder.js) and the person calibrates on
// their own rig.
//
// Positive moves the video's start EARLIER against the notes, so a note shows
// later into the video; use it when notes fall before the start of the video.
// Negative moves it later. It only applies to recordings added after it is set;
// ones already added keep their stored start (adjust those under Video in
// Settings > Adjust timing).

const MAX_OFFSET_S = 60;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// { seconds, error }: `seconds` is always a usable number (0 when unset or
// when `raw` is not valid); `error` says why a set value was refused.
function parseVideoOffset(raw) {
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!text) return { seconds: 0, error: null };
    const seconds = NUMBER.test(text) ? Number(text) : NaN;
    if (!Number.isFinite(seconds) || Math.abs(seconds) > MAX_OFFSET_S) {
        return { seconds: 0, error: `VIDEO_OFFSET_S must be a number of seconds from -${MAX_OFFSET_S} to ${MAX_OFFSET_S}; using none` };
    }
    // Millisecond precision is all a start time has; -0 is just 0.
    return { seconds: Math.round(seconds * 1000) / 1000 + 0, error: null };
}

const configFromEnv = (env) => parseVideoOffset(env.VIDEO_OFFSET_S);

module.exports = { parseVideoOffset, configFromEnv, MAX_OFFSET_S };
