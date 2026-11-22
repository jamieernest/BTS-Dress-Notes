const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v = require('../eos-venues');
const { loadSettings, saveSettings } = require('../settings');

test('cleanHost accepts dotted IPv4 only', () => {
    assert.strictEqual(v.cleanHost(' 10.10.160.143 '), '10.10.160.143');
    assert.strictEqual(v.cleanHost('0.0.0.0'), '0.0.0.0');
    for (const bad of ['', '10.10.160', '10.10.160.256', '10.10.160.1.1', '010.1.1.1', 'eos.local', '1.2.3.4:3037', '1.2.3.-4', '1e1.2.3.4', null, 5, {}]) {
        assert.strictEqual(v.cleanHost(bad), null, String(bad));
    }
});

test('cleanName trims, collapses spaces and bounds length', () => {
    assert.strictEqual(v.cleanName('  Royal   Hall '), 'Royal Hall');
    assert.strictEqual(v.cleanName('x'.repeat(60)), 'x'.repeat(60));
    for (const bad of ['', '   ', 'x'.repeat(61), 'a\u0000b', 7, null]) assert.strictEqual(v.cleanName(bad), null);
});

test('saveVenue adds, edits and rejects duplicates and bad input', () => {
    let r = v.saveVenue([], { name: 'Theatre A', host: '10.0.0.1' });
    assert.ok(r.venue.id);
    const a = r.venue;
    r = v.saveVenue(r.venues, { name: 'Theatre B', host: '10.0.0.2' });
    assert.strictEqual(r.venues.length, 2);
    assert.match(v.saveVenue(r.venues, { name: 'theatre a', host: '10.0.0.3' }).error, /already exists/);
    assert.match(v.saveVenue(r.venues, { name: 'Theatre C', host: '10.0.0' }).error, /IPv4/);
    assert.match(v.saveVenue(r.venues, { name: '', host: '10.0.0.3' }).error, /name/);
    assert.match(v.saveVenue(r.venues, { id: 'nope', name: 'X', host: '10.0.0.3' }).error, /no longer/);
    // Editing keeps the id, and a venue may keep its own name.
    const edited = v.saveVenue(r.venues, { id: a.id, name: 'Theatre A', host: '10.0.0.9' });
    assert.strictEqual(edited.venue.id, a.id);
    assert.strictEqual(edited.venues[0].host, '10.0.0.9');
    assert.match(v.saveVenue(r.venues, { id: a.id, name: 'THEATRE B', host: '10.0.0.9' }).error, /already exists/);
    const full = Array.from({ length: v.MAX_VENUES }, (_, i) => ({ id: `i${i}`, name: `V${i}`, host: '1.1.1.1' }));
    assert.match(v.saveVenue(full, { name: 'More', host: '1.1.1.1' }).error, /Up to/);
});

test('cleanVenues and cleanChoice drop malformed saved data', () => {
    const venues = v.cleanVenues([
        { id: 'a', name: 'One', host: '1.1.1.1' }, { id: 'a', name: 'Dup id', host: '1.1.1.2' },
        { id: 'b', name: 'one', host: '1.1.1.3' }, { id: 'c', name: 'Bad', host: 'nope' }, null, { name: 'No id', host: '1.1.1.4' }
    ]);
    assert.deepStrictEqual(venues, [{ id: 'a', name: 'One', host: '1.1.1.1' }]);
    assert.deepStrictEqual(v.cleanChoice({ venue: 'a' }, venues), { venue: 'a' });
    assert.strictEqual(v.cleanChoice({ venue: 'gone' }, venues), null);
    assert.deepStrictEqual(v.cleanChoice({ host: '2.2.2.2' }, venues), { host: '2.2.2.2' });
    assert.strictEqual(v.cleanChoice({ host: 'x' }, venues), null);
    assert.strictEqual(v.cleanChoice(undefined, venues), null);
});

test('resolveHost: default, venue, custom; venues and choice survive a restart', () => {
    const venues = [{ id: 'a', name: 'One', host: '1.1.1.1' }];
    assert.strictEqual(v.resolveHost(null, venues, '9.9.9.9'), '9.9.9.9');
    assert.strictEqual(v.resolveHost({ venue: 'a' }, venues, '9.9.9.9'), '1.1.1.1');
    assert.strictEqual(v.resolveHost({ host: '2.2.2.2' }, venues, '9.9.9.9'), '2.2.2.2');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eos-venues-')), 'local-settings.json');
    saveSettings(file, { networkInterface: 'auto', eosVenues: venues, eosChoice: { venue: 'a' } });
    const back = loadSettings(file);
    assert.deepStrictEqual(v.cleanVenues(back.eosVenues), venues);
    assert.deepStrictEqual(v.cleanChoice(back.eosChoice, venues), { venue: 'a' });
});
