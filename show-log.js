// A timeline of the show: every Dress Notes scene change (/bts/) and every LX
// cue that went live on the desk, each stamped with the server's clock. Notes
// only record the scene and cue current when they arrived, so without this a
// scene or cue nobody wrote a note in leaves no trace; with it, playback.html
// can line the whole show up with a Vor recording.
//
// Kept in globalState.showLog, written to backups and the JSON export with the
// notes, restored with them and cleared by "Reset all notes and chat".

const { z } = require('zod');

const TYPES = ['scene', 'cue'];
const MAX_VALUE_LENGTH = 200;
// A show is a few hundred cues; this only stops a runaway sender filling memory.
const MAX_EVENTS = 20000;

// "13 Build before Effect 3.9 3%" -> "13 Build before Effect": Eos resends the
// active cue with a falling time and rising percentage while it fades, and
// that is still the same cue.
function cueName(text) {
    const m = /^(.*?)(?:\s+\d+(?:\.\d+)?)?(?:\s+\d+%)?\s*$/.exec(String(text || '').trim());
    return (m ? m[1] : String(text || '')).slice(0, MAX_VALUE_LENGTH);
}

const eventSchema = z.object({
    type: z.enum(TYPES),
    value: z.string().refine((s) => s.trim() !== '').transform((s) => s.slice(0, MAX_VALUE_LENGTH)),
    at: z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)))
});

// Appends an event unless the last one of its type had the same value (a fade
// resending the cue, a scene sent twice). Returns whether it was added.
function record(log, type, value, at = new Date()) {
    const clean = eventSchema.safeParse({ type, value: type === 'cue' ? cueName(value) : String(value || ''), at: at.toISOString() });
    if (!clean.success) return false;
    for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].type !== type) continue;
        if (log[i].value === clean.data.value) return false;
        break;
    }
    log.push(clean.data);
    if (log.length > MAX_EVENTS) log.splice(0, log.length - MAX_EVENTS);
    return true;
}

// A backup's or import's log, rebuilt event by event in time order; anything
// malformed is left out, and a missing log (older backups) is an empty one.
function cleanShowLog(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map((e) => eventSchema.safeParse(e))
        .filter((r) => r.success)
        .map((r) => r.data)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .slice(-MAX_EVENTS);
}

module.exports = { cueName, record, cleanShowLog, MAX_EVENTS };
