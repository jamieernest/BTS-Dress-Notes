// Whether Keycloak login is on, from the environment. Never guessed from
// absence alone: a missing or unread .env must not quietly open the app, so
// KEYCLOAK_* settings without KEYCLOAK_ENABLED stop the server instead.
const KEYCLOAK_VARS = ['KEYCLOAK_ISSUER', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET'];
const ON = new Set(['1', 'true', 'on', 'yes']);
const OFF = new Set(['0', 'false', 'off', 'no']);

// { enabled } or { error } (a message for the log; the server then exits).
function resolveAuthMode(env) {
    const flag = String(env.KEYCLOAK_ENABLED ?? '').trim().toLowerCase();
    const present = KEYCLOAK_VARS.filter((name) => env[name]);
    if (ON.has(flag)) {
        const missing = KEYCLOAK_VARS.filter((name) => !env[name]);
        return missing.length ? { error: `KEYCLOAK_ENABLED is on but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set.` } : { enabled: true };
    }
    if (flag === '' && present.length) {
        return { error: `${present.join(', ')} set but KEYCLOAK_ENABLED is not. Set KEYCLOAK_ENABLED=1 to use Keycloak login, or KEYCLOAK_ENABLED=0 to run without it.` };
    }
    if (flag === '' || OFF.has(flag)) return { enabled: false };
    return { error: `KEYCLOAK_ENABLED must be 1 or 0, not "${env.KEYCLOAK_ENABLED}".` };
}

module.exports = { resolveAuthMode, KEYCLOAK_VARS };
