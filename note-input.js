// Cleans what browsers send over the socket before it is stored or broadcast.
// Every client is trusted to be logged in, not to be well formed: a missing or
// odd field from an old tab, a bug or a hand-made message must not throw (one
// exception in a handler used to take the server down for everyone) or put
// junk into the notes every other browser renders.
//
// The shapes are zod schemas. Objects are rebuilt from the known fields only
// (zod drops the rest), and each clean*() returns the cleaned value or null,
// never throws. Rendering still escapes everything (public/safe-html.js): this
// is about shape and size, not HTML.

const { z } = require('zod');

const MAX_NOTE_LENGTH = 10000;
const MAX_COMMENT_LENGTH = 5000;
const MAX_TAGS = 50;
const MAX_TAG_NAME_LENGTH = 60;
const MAX_ID_LENGTH = 100;
const MAX_CUE_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MODES = ['midi', 'network', 'realtime'];
const HEX_COLOUR = /^#(?:[0-9a-f]{3}){1,2}$/i;

const parse = (schema, value) => {
    const result = schema.safeParse(value);
    return result.success ? result.data : null;
};

// Text with something in it, cut to `max` characters.
const textSchema = (max) => z.string().refine((s) => s.trim() !== '').transform((s) => s.slice(0, max));

// A short identifier string (note, comment, tag or client id); numbers are accepted as strings.
const idSchema = z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(MAX_ID_LENGTH));

// A list of distinct tag ids; entries that are not ids are skipped. Only the
// first few entries are looked at, so a huge list costs no more than a short one.
const tagsSchema = z.custom((value) => Array.isArray(value)).transform((list) => {
    const ids = [];
    for (const v of list.slice(0, MAX_TAGS * 2)) {
        const id = parse(idSchema, v);
        if (id && !ids.includes(id)) ids.push(id);
        if (ids.length >= MAX_TAGS) break;
    }
    return ids;
});

const wholeNumber = (max) => z.coerce.number().transform((n) => Math.min(max, Math.max(0, Math.floor(n))));

// A number of frames per second, or 'ms' for real time.
const frameRateSchema = z.union([z.literal('ms'), z.coerce.number().gt(0).lte(120)]);

const modeSchema = z.enum(MODES);

// A timecode as the browser froze it. Hours, minutes and seconds are required;
// the other fields are dropped (or zeroed) when they are not valid.
const timecodeSchema = z.object({
    hours: wholeNumber(99),
    minutes: wholeNumber(59),
    seconds: wholeNumber(59),
    frames: wholeNumber(119).catch(0),
    milliseconds: wholeNumber(999).catch(0).optional(),
    frameRate: frameRateSchema.optional().catch(undefined),
    source: modeSchema.optional().catch(undefined),
    displayMode: modeSchema.optional().catch(undefined)
}).transform(withoutUndefined);

// An LX cue label (or act name); numbers are accepted as strings.
const cueSchema = z.union([z.string(), z.number()]).transform(String)
    .refine((s) => s.trim() !== '').transform((s) => s.slice(0, MAX_CUE_LENGTH));

const colourSchema = z.string().regex(HEX_COLOUR);

// A tag from the tag editor: { id, name, color } with a #rgb/#rrggbb colour.
const tagSchema = z.object({
    id: idSchema.nullable().catch(null).default(null),
    name: z.string().transform((s) => s.trim().slice(0, MAX_TAG_NAME_LENGTH)).pipe(z.string().min(1)),
    color: colourSchema.nullable().catch(null).default(null)
});

// Notes and comments as stored, for a backup imported from the config page or
// loaded at start-up: the same fields a live note gets, each bounded, so a
// hand-edited file cannot carry anything a live note could not. Optional
// fields that are not valid are dropped rather than failing the whole file.
const optionalString = (max) => z.string().max(max).optional().catch(undefined);
const timestampSchema = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)));

const storedCommentSchema = z.object({
    id: idSchema,
    user: z.string().transform((s) => s.slice(0, MAX_NAME_LENGTH)).catch(''),
    userId: optionalString(MAX_NAME_LENGTH),
    text: z.string().transform((s) => s.slice(0, MAX_COMMENT_LENGTH)),
    timestamp: timestampSchema.optional().catch(undefined),
    lastEdited: timestampSchema.optional().catch(undefined),
    lastEditedBy: optionalString(MAX_NAME_LENGTH)
}).transform(withoutUndefined);

const storedNoteSchema = z.object({
    id: idSchema,
    clientId: idSchema.optional().catch(undefined),
    user: z.string().transform((s) => s.slice(0, MAX_NAME_LENGTH)).catch(''),
    userId: optionalString(MAX_NAME_LENGTH),
    text: z.string().transform((s) => s.slice(0, MAX_NOTE_LENGTH)),
    timecode: timecodeSchema.nullable().catch(null).default(null),
    lxCue: cueSchema.nullable().catch(null).default(null),
    timestamp: timestampSchema,
    startedAt: timestampSchema.optional().catch(undefined),
    frameRate: frameRateSchema.nullable().catch(null).default(null),
    tags: tagsSchema.catch([]).default([]),
    act: cueSchema.nullable().catch(null).default(null),
    comments: z.array(z.unknown()).catch([]).default([])
        .transform((list) => list.map((c) => parse(storedCommentSchema, c)).filter(Boolean)),
    lastEdited: timestampSchema.optional().catch(undefined),
    lastEditedBy: optionalString(MAX_NAME_LENGTH)
}).transform(withoutUndefined);

const storedTagSchema = tagSchema.extend({ id: idSchema });

function withoutUndefined(object) {
    for (const key of Object.keys(object)) if (object[key] === undefined) delete object[key];
    return object;
}

function cleanText(value, max) { return parse(textSchema(max), value); }
function cleanId(value) { return parse(idSchema, value); }
function cleanTags(value) { return parse(tagsSchema, value) || []; }
function cleanFrameRate(value) { return parse(frameRateSchema, value); }
// Null when it is not a timecode, so the caller falls back to the server's current one.
function cleanTimecode(value) { return parse(timecodeSchema, value); }
function cleanCue(value) { return parse(cueSchema, value); }
function cleanTag(value) { return parse(tagSchema, value); }

// The notes of a backup that has passed checkBackup() (notes-backup.js),
// rebuilt field by field; a note that cannot be rebuilt is left out. Put in
// timestamp order, as new notes are inserted assuming it (note-order.js);
// the sort is stable, so equal stamps keep their order.
function cleanStoredNotes(notes) {
    const stamp = (n) => { const ms = Date.parse(n.timestamp); return Number.isNaN(ms) ? Infinity : ms; };
    return notes.map((n) => parse(storedNoteSchema, n)).filter(Boolean).sort((a, b) => stamp(a) - stamp(b));
}

// A backup's tag list, keeping only well-formed tags with an id.
function cleanStoredTags(tags) {
    return tags.map((t) => parse(storedTagSchema, t)).filter(Boolean);
}

module.exports = {
    MAX_NOTE_LENGTH, MAX_COMMENT_LENGTH,
    cleanText, cleanId, cleanTags, cleanFrameRate, cleanTimecode, cleanCue, cleanTag,
    cleanStoredNotes, cleanStoredTags
};
