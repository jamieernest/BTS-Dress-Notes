// How a timecode or the time of day is written, the same on every page and
// overlay: HH:MM:SS:FF for timecode, HH:MM:SS.cc (hundredths) for the time of
// day, so the two never read as each other.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TimecodeFormat = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const pad = (n) => String(n || 0).padStart(2, '0');

    // `tc.displayMode === 'realtime'` marks a time of day (with milliseconds).
    function formatTimecode(tc) {
        if (!tc || typeof tc !== 'object') return '00:00:00:00';
        if (tc.displayMode === 'realtime') return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}.${pad(Math.floor((tc.milliseconds || 0) / 10))}`;
        return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}:${pad(tc.frames)}`;
    }

    // A note taken against the time of day has frameRate 'ms'.
    function formatNoteTimecode(note) {
        if (!note.timecode || typeof note.timecode !== 'object') return formatTimecode(null);
        if (note.frameRate === 'ms') return formatTimecode({ ...note.timecode, displayMode: 'realtime' });
        return formatTimecode(note.timecode);
    }

    // This device's time of day, as a timecode-shaped object.
    function timeOfDay(now = new Date()) {
        return {
            hours: now.getHours(),
            minutes: now.getMinutes(),
            seconds: now.getSeconds(),
            milliseconds: now.getMilliseconds(),
            displayMode: 'realtime'
        };
    }

    return { pad, formatTimecode, formatNoteTimecode, timeOfDay };
}));
