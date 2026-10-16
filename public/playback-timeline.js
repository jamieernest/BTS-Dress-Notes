// Lining notes up with a Vor recording (playback.html, proof of concept).
// Everything is in clock time (ms since the epoch); a video position is
// clock time minus the moment the recording started.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PlaybackTimeline = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    // Vor names each file after the local date and time recording started,
    // e.g. "BUSMS Addams Family 26.2026-10-07 19-37-58.mov". A frame of that file
    // showed Vor's clock overlay within 0.15 s of the name. Null when absent.
    const VOR_STAMP = /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[-.:](\d{2})[-.:](\d{2})/;

    function vorStartFromName(name) {
        const m = VOR_STAMP.exec(name || '');
        if (!m) return null;
        const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
        return new Date(y, mo - 1, d, h, mi, s).getTime();
    }

    // "BUSMS Addams Family 26.2026-10-07 ..." -> "BUSMS Addams Family 26".
    function vorTitleFromName(name) {
        const m = /^(.*?)\.?\s*\d{4}-\d{2}-\d{2}/.exec(name || '');
        return m && m[1] ? m[1] : null;
    }

    // When a note happened. `sent`: the server's stamp. `typed`: when its author
    // started typing it, the moment they saw. Newer notes carry startedAt on
    // the server's clock; older ones only have it as a realtime timecode,
    // read as the local clock on the day it was sent (the day before if that
    // would be after it was sent), and nothing at all in MIDI or network mode.
    function noteTimes(note) {
        const sent = Date.parse(note.timestamp);
        const started = Date.parse(note.startedAt);
        const tc = note.timecode;
        let typed = null;
        if (Number.isFinite(started)) {
            typed = started;
        } else if (Number.isFinite(sent) && tc && tc.displayMode === 'realtime') {
            const day = new Date(sent);
            typed = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                tc.hours, tc.minutes, tc.seconds, tc.milliseconds || 0).getTime();
            if (typed > sent + HOUR) typed -= DAY;
        }
        return { sent: Number.isFinite(sent) ? sent : null, typed };
    }

    // "13 Build before Effect 3.9 3%" -> "13 Build before Effect": the cue
    // without the fade time and percentage Eos adds while it runs.
    function cueLabel(lxCue) {
        if (!lxCue) return '';
        const m = /^(.*?)(?:\s+\d+(?:\.\d+)?)?(?:\s+\d+%)?\s*$/.exec(String(lxCue).trim());
        return m ? m[1] : String(lxCue);
    }

    // The scene changes or LX cues of a show, as { value, at } in time order.
    // Exports with a showLog (show-log.js) have every one at the moment it
    // happened. Older ones only have what each note recorded when it arrived,
    // so a change shows at the first note after it (`exact` false), and one
    // nobody wrote a note in is missing.
    function changes(data, type) {
        if (Array.isArray(data.showLog) && data.showLog.length) {
            return {
                exact: true,
                list: data.showLog
                    .filter(e => e && e.type === type && e.value && Number.isFinite(Date.parse(e.at)))
                    .map(e => ({ value: String(e.value), at: Date.parse(e.at) }))
                    .sort((a, b) => a.at - b.at)
            };
        }
        const valueOf = type === 'scene' ? (n => n.act) : (n => cueLabel(n.lxCue));
        return { exact: false, list: spans(data.notes || [], valueOf).map(s => ({ value: s.value, at: s.start })) };
    }

    // The value in force at `at`: the last change at or before it.
    function valueAt(list, at) {
        let current = null;
        for (const c of list) {
            if (c.at > at) break;
            current = c;
        }
        return current;
    }

    // Spans of the show during which notes kept reporting the same value (scene
    // or LX cue), each from its first note to the first note with another value.
    // The last span has end null.
    function spans(notes, valueOf) {
        const seen = notes
            .map(note => ({ at: Date.parse(note.timestamp), value: valueOf(note) }))
            .filter(x => Number.isFinite(x.at) && x.value)
            .sort((a, b) => a.at - b.at);
        const out = [];
        for (const x of seen) {
            const last = out[out.length - 1];
            if (last && last.value === x.value) continue;
            if (last) last.end = x.at;
            out.push({ value: x.value, start: x.at, end: null });
        }
        return out;
    }

    // A clock read off the video ("7:47:58.15", 12 or 24 hour) as clock time
    // on the day of `near`, taking whichever of am/pm lies closer to it.
    function parseClock(text, near) {
        const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*$/.exec(text || '');
        if (!m) return null;
        const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
        const frac = m[4] ? Number('0.' + m[4]) : 0;
        if (h > 23 || mi > 59 || s > 59) return null;
        const day = new Date(near);
        const at = (hours) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, mi, s).getTime() + frac * 1000;
        const options = h < 12 ? [at(h), at(h + 12)] : [at(h)];
        return options.reduce((best, t) => Math.abs(t - near) < Math.abs(best - near) ? t : best);
    }

    return { vorStartFromName, vorTitleFromName, noteTimes, cueLabel, spans, changes, valueAt, parseClock };
}));
