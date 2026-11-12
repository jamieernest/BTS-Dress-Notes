// Agreement identity is always supplied by the authenticated server session.
const { z } = require('zod');
const { optionalUsernameSchema } = require('./profile-photos');
const MAX_AGREEMENTS = 500;
const person = z.object({
    userId: z.string().min(1).max(200),
    name: z.string().trim().min(1).transform(s => s.slice(0, 200)),
    // The website username (historical wire name), so the list can show profile photos.
    emailPrefix: optionalUsernameSchema
}).transform(p => p.emailPrefix ? p : { userId: p.userId, name: p.name });

function cleanAgreements(value) {
    const people = new Map();
    if (!Array.isArray(value)) return [];
    for (const raw of value.slice(0, MAX_AGREEMENTS * 2)) {
        const parsed = person.safeParse(raw);
        if (parsed.success && !people.has(parsed.data.userId)) people.set(parsed.data.userId, parsed.data);
        if (people.size === MAX_AGREEMENTS) break;
    }
    return [...people.values()];
}

function toggleAgreement(note, actor) {
    const agreements = cleanAgreements(note.agreements);
    const index = agreements.findIndex(p => p.userId === actor.userId);
    if (index >= 0) agreements.splice(index, 1);
    else {
        const parsed = person.safeParse(actor);
        if (!parsed.success || agreements.length >= MAX_AGREEMENTS) return false;
        agreements.push(parsed.data);
    }
    note.agreements = agreements;
    return true;
}

module.exports = { MAX_AGREEMENTS, cleanAgreements, toggleAgreement };
