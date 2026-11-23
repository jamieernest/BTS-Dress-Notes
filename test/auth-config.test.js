const test = require('node:test');
const assert = require('node:assert');
const { resolveAuthMode } = require('../auth-config');

const all = { KEYCLOAK_ISSUER: 'https://sso.example', KEYCLOAK_CLIENT_ID: 'bts', KEYCLOAK_CLIENT_SECRET: 'x' };

test('nothing set: Keycloak is off', () => {
    assert.deepStrictEqual(resolveAuthMode({}), { enabled: false });
    assert.deepStrictEqual(resolveAuthMode({ KEYCLOAK_ENABLED: '0', ...all }), { enabled: false }, 'deliberately off, settings ignored');
});

test('on needs all three settings', () => {
    assert.deepStrictEqual(resolveAuthMode({ KEYCLOAK_ENABLED: '1', ...all }), { enabled: true });
    assert.deepStrictEqual(resolveAuthMode({ KEYCLOAK_ENABLED: 'true', ...all }), { enabled: true });
    const { error } = resolveAuthMode({ KEYCLOAK_ENABLED: '1', KEYCLOAK_ISSUER: 'https://sso.example' });
    assert.match(error, /KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET are not set/);
});

test('Keycloak settings without the flag stop the server rather than open it', () => {
    assert.match(resolveAuthMode(all).error, /KEYCLOAK_ENABLED/);
    assert.match(resolveAuthMode({ KEYCLOAK_CLIENT_SECRET: 'x' }).error, /KEYCLOAK_CLIENT_SECRET set but KEYCLOAK_ENABLED is not/);
    assert.deepStrictEqual(resolveAuthMode({ KEYCLOAK_ISSUER: '' }), { enabled: false }, 'blank counts as unset');
});

test('a flag that is neither on nor off is an error, not "off"', () => {
    assert.match(resolveAuthMode({ KEYCLOAK_ENABLED: 'maybe' }).error, /must be 1 or 0/);
});
