// Who may use the Config & Status page and its controls (set the time mode, MIDI
// input and network interface, reconnect Eos, reset all notes and chat).
//
// The list comes from a JSON file (`admins.json`, git-ignored: an array of
// strings or { "admins": [...] }) and/or the ADMIN_USERS environment variable
// (comma separated). An entry is a person's Keycloak `sub`, username
// (`preferred_username`) or email, compared case-insensitively. Display names
// are not matched: they are not unique.
//
// With neither a file nor ADMIN_USERS the feature is off and everybody is an
// admin (how the app behaved before this existed). Once either exists it is
// enforced, even if the list is empty or the file cannot be read, so a typo
// cannot open the page up.
const fs = require('fs');

const norm = (v) => String(v).trim().toLowerCase();

function parseAdminList(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data && Array.isArray(data.admins) ? data.admins : null;
    if (!list) throw new Error('expected an array of users or { "admins": [...] }');
    return list.filter((v) => typeof v === 'string' && v.trim() !== '').map(norm);
}

// The identifiers a signed-in user can be listed by.
function identifiersOf(user) {
    if (!user) return [];
    const ids = [user.sub, user.username];
    // An email is only trusted when Keycloak has not said it is unverified.
    if (user.email && user.emailVerified !== false) ids.push(user.email);
    return ids.filter((v) => typeof v === 'string' && v !== '').map(norm);
}

function createAdmins({ file, env = '', log = () => {} } = {}) {
    const fromEnv = String(env || '').split(',').map(norm).filter(Boolean);
    let cache = { stamp: undefined, entries: null, error: null };

    // Re-read the file when it changes, so editing it needs no restart.
    function fileEntries() {
        let stamp = null;
        try { stamp = fs.statSync(file).mtimeMs; } catch (e) { /* no file */ }
        if (stamp === cache.stamp) return cache;
        cache = { stamp, entries: null, error: null };
        if (stamp === null) return cache;
        try {
            cache.entries = parseAdminList(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            cache.error = error;
            log(`Admins: cannot use ${file}, so nobody is an admin until it is fixed: ${error.message}`);
        }
        return cache;
    }

    function state() {
        const f = file ? fileEntries() : { entries: null, error: null };
        const enforced = fromEnv.length > 0 || f.entries !== null || f.error !== null;
        return { enforced, entries: new Set([...fromEnv, ...(f.entries || [])]) };
    }

    return {
        // False when no list is configured (everybody is an admin).
        isEnforced: () => state().enforced,
        isAdmin(user) {
            const { enforced, entries } = state();
            if (!enforced) return true;
            return identifiersOf(user).some((id) => entries.has(id));
        }
    };
}

module.exports = { createAdmins, parseAdminList, identifiersOf };
