const test = require('node:test');
const assert = require('node:assert');
const { suggestTagCommand, firstTagCommand, tagCommandKeys, consumeTagCommand, consumeShitpostCommand, consumeShitpostCommandAt } = require('../public/tag-commands');

const tags = [
    { id: 'safety', name: 'Safety/Show Critical' },
    { id: 'lighting', name: 'Lighting' }
];

test('suggests dashed commands from tag names', () => {
    assert.equal(suggestTagCommand('Safety/Show Critical'), 'safety-show-critical');
    assert.equal(suggestTagCommand('Critical Plus'), 'critical-plus');
});

test('selects a tag by its dashed name command', () => {
    assert.deepEqual(consumeTagCommand('/safety-show-critical ', tags), { tagId: 'safety', value: '', cursor: 0 });
    assert.equal(consumeTagCommand('/safety-show-critical', tags), null);
    assert.equal(consumeTagCommand('/setup ', [{ id: 'set', name: 'Set' }]), null);
    assert.equal(consumeTagCommand('/critical', tags), null);
});

test('uses a configured command instead of the tag name', () => {
    const configured = [{ id: 'safety', name: 'Safety/Show Critical', command: 'urgent' }];
    assert.deepEqual(consumeTagCommand('/urgent ', configured), { tagId: 'safety', value: '', cursor: 0 });
    assert.equal(consumeTagCommand('/urgent', configured), null);
    assert.equal(consumeTagCommand('/safety-show-critical ', configured), null);
});

test('selects a tag without disturbing the note', () => {
    assert.deepEqual(consumeTagCommand('Check this /lighting now', tags, 25), {
        tagId: 'lighting', value: 'Check this now', cursor: 15
    });
});

test('supports comma-separated slash command aliases', () => {
    const configured = [{ id: 'lighting', name: 'Lighting', command: 'lighting, lx, lamps' }];
    assert.deepEqual(tagCommandKeys(configured[0]), ['lighting', 'lx', 'lamps']);
    assert.equal(firstTagCommand(configured[0]), 'lighting');
    assert.deepEqual(consumeTagCommand('/lx ', configured), { tagId: 'lighting', value: '', cursor: 0 });
    assert.deepEqual(consumeTagCommand('/lighting text', configured, 15), { tagId: 'lighting', value: 'text', cursor: 5 });
    assert.equal(consumeTagCommand('/l ', configured), null);
});

test('routes a standalone shitpost command to chat text', () => {
    assert.equal(consumeShitpostCommand('/shitpost this belongs in chat'), 'this belongs in chat');
    assert.equal(consumeShitpostCommand('before /shitpost after'), 'before after');
    assert.equal(consumeShitpostCommand('/shitpost'), '');
    assert.equal(consumeShitpostCommand('not/shitpost text'), null);
});

test('preserves the cursor while consuming a shitpost command', () => {
    assert.deepEqual(consumeShitpostCommandAt('/shitpost keep typing'), { text: 'keep typing', cursor: 11 });
    assert.deepEqual(consumeShitpostCommandAt('before /shitpost after'), { text: 'before after', cursor: 12 });
    assert.deepEqual(consumeShitpostCommandAt('lemon /shitpost pie', 15), { text: 'lemon pie', cursor: 5 });
});
