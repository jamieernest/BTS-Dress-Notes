// Eos console address: a per-install list of venues (name + IPv4 address) and
// the current choice (a saved venue, a custom address, or the EOS_HOST default).
// Everything from a socket is cleaned here before it is stored.
const crypto = require('crypto');

const MAX_VENUES = 50;
const MAX_NAME_LENGTH = 60;

// Dotted IPv4 only: four decimal parts 0-255, no leading zeros (so no octal reading).
function cleanHost(value) {
    if (typeof value !== 'string') return null;
    const host = value.trim();
    const parts = host.split('.');
    if (parts.length !== 4) return null;
    for (const part of parts) {
        if (!/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null;
    }
    return host;
}

function cleanName(value) {
    if (typeof value !== 'string') return null;
    const name = value.replace(/\s+/g, ' ').trim();
    // eslint-disable-next-line no-control-regex
    if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) return null;
    return name;
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// The saved list as stored in settings, dropping anything malformed or duplicated.
function cleanVenues(value) {
    if (!Array.isArray(value)) return [];
    const venues = [];
    for (const v of value) {
        if (!v || typeof v !== 'object') continue;
        const name = cleanName(v.name);
        const host = cleanHost(v.host);
        const id = typeof v.id === 'string' && /^[\w-]{1,64}$/.test(v.id) ? v.id : null;
        if (!name || !host || !id) continue;
        if (venues.some((x) => x.id === id || sameName(x.name, name))) continue;
        venues.push({ id, name, host });
        if (venues.length >= MAX_VENUES) break;
    }
    return venues;
}

// The saved choice: { venue: id } or { host } (custom); anything else is the default.
function cleanChoice(value, venues) {
    if (value && typeof value === 'object') {
        if (typeof value.venue === 'string' && venues.some((v) => v.id === value.venue)) return { venue: value.venue };
        const host = cleanHost(value.host);
        if (host && value.venue === undefined) return { host };
    }
    return null;
}

// Address in use for a choice; null choice means the EOS_HOST default.
function resolveHost(choice, venues, defaultHost) {
    if (choice?.venue) return venues.find((v) => v.id === choice.venue)?.host || defaultHost;
    return choice?.host || defaultHost;
}

// Adds (no id) or edits (id) a venue. Returns { venues } or { error }.
function saveVenue(venues, input) {
    if (!input || typeof input !== 'object') return { error: 'Enter a name and an IP address.' };
    const name = cleanName(input.name);
    if (!name) return { error: `Enter a venue name of up to ${MAX_NAME_LENGTH} characters.` };
    const host = cleanHost(input.host);
    if (!host) return { error: 'Enter an IPv4 address such as 10.10.160.143.' };
    const id = input.id === undefined || input.id === null ? null : input.id;
    const existing = id === null ? null : venues.find((v) => v.id === id);
    if (id !== null && !existing) return { error: 'That venue no longer exists.' };
    if (venues.some((v) => v !== existing && sameName(v.name, name))) return { error: 'A venue with that name already exists.' };
    if (!existing && venues.length >= MAX_VENUES) return { error: `Up to ${MAX_VENUES} venues can be saved.` };
    const saved = { id: existing ? existing.id : crypto.randomUUID(), name, host };
    return { venue: saved, venues: existing ? venues.map((v) => (v === existing ? saved : v)) : [...venues, saved] };
}

module.exports = { cleanHost, cleanName, cleanVenues, cleanChoice, resolveHost, saveVenue, MAX_VENUES, MAX_NAME_LENGTH };
