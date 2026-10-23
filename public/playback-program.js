// A recording in several parts as one timeline (playback.html). Each part is
// placed at the clock time it started, so the time between two parts (Vor
// stopped, then started again) stays on the timeline as a blank gap, and
// notes written during it still sit where they happened.
//
// A part with no start time follows straight on from the part before it (or
// ends where the next one starts); with none known at all the parts play back
// to back and the timeline has no clock (origin null) until one is matched.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PlaybackProgram = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    // parts: [{ id, startAt (ms or null), duration (seconds), ... }].
    // Returns { origin, total, segments }: origin is the clock time of the
    // timeline's start, total its length in seconds, and each segment is its
    // part plus `start` (clock ms, null when untimed), `offset` and `end`
    // (seconds along the timeline), in time order.
    function layout(parts) {
        const list = parts
            .filter(p => p && Number.isFinite(p.duration) && p.duration > 0)
            .map(p => ({ ...p, start: Number.isFinite(p.startAt) ? p.startAt : null }));
        if (list.every(p => p.start !== null)) list.sort((a, b) => a.start - b.start);
        for (let i = 1; i < list.length; i++) {
            const before = list[i - 1];
            if (list[i].start === null && before.start !== null) list[i].start = before.start + before.duration * 1000;
        }
        for (let i = list.length - 2; i >= 0; i--) {
            const after = list[i + 1];
            if (list[i].start === null && after.start !== null) list[i].start = after.start - list[i].duration * 1000;
        }
        const timed = list.length > 0 && list[0].start !== null;
        let next = 0;
        const segments = list.map(p => {
            const offset = timed ? (p.start - list[0].start) / 1000 : next;
            next = offset + p.duration;
            return { ...p, start: timed ? p.start : null, offset, end: offset + p.duration };
        });
        const first = timed ? Math.min(...segments.map(s => s.offset)) : 0;
        for (const s of segments) { s.offset -= first; s.end -= first; }
        segments.sort((a, b) => a.offset - b.offset);
        return {
            origin: timed ? list[0].start + first * 1000 : null,
            total: segments.reduce((most, s) => Math.max(most, s.end), 0),
            segments
        };
    }

    // What plays `pos` seconds along: { segment, local } with the position
    // inside that part, or { segment: null, next } in a gap (next: the part
    // after it, null past the end). Where parts overlap the earlier one plays.
    function locate(program, pos) {
        const segment = program.segments.find(s => pos >= s.offset && pos < s.end);
        if (segment) return { segment, local: pos - segment.offset };
        return { segment: null, next: program.segments.find(s => s.offset > pos) || null };
    }

    // The blank stretches between parts, as { from, to } seconds.
    function gaps(program) {
        const out = [];
        let reached = 0;
        for (const s of program.segments) {
            if (s.offset > reached) out.push({ from: reached, to: s.offset });
            reached = Math.max(reached, s.end);
        }
        return out;
    }

    return { layout, locate, gaps };
}));
