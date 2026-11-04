const test = require('node:test');
const assert = require('node:assert');
const { suggestTagCommand } = require('../public/tag-commands');
const { validColor, payload } = require('../public/config-tags');

test('new tags need a six-digit hex colour', () => {
    assert.equal(validColor('#FF0000'), true);
    assert.equal(validColor('#fff'), false);
    assert.equal(validColor('red'), false);
});

test('new tag payloads trim fields and suggest a dashed command', () => {
    assert.deepEqual(payload(null, ' Critical Plus ', '#ff0000', '', suggestTagCommand), {
        name: 'Critical Plus', color: '#ff0000', command: 'critical-plus'
    });
});

test('explicit commands and existing ids are preserved', () => {
    assert.deepEqual(payload({ id: 'safety' }, 'Safety', '#E63946', 'urgent', suggestTagCommand), {
        id: 'safety', name: 'Safety', color: '#E63946', command: 'urgent'
    });
});

test('invalid new tag fields produce no payload', () => {
    assert.equal(payload(null, '', '#FF0000', '', suggestTagCommand), null);
    assert.equal(payload(null, 'Safety', '#FF000', '', suggestTagCommand), null);
});