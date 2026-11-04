const test = require('node:test');
const assert = require('node:assert');
const { consumeTagCommand, consumeShitpostCommand } = require('../public/tag-commands');

const tags = [
    { id: 'safety', name: 'Safety/Show Critical' },
    { id: 'lighting', name: 'Lighting' }
];

test('selects a tag by a word in its name', () => {
    assert.deepEqual(consumeTagCommand('/critical', tags), {
        tagId: 'safety', value: '', cursor: 0
    });
});

test('uses a configured command instead of the tag id or name', () => {
    const configured = [{ id: 'safety', name: 'Safety/Show Critical', command: 'urgent' }];
    assert.deepEqual(consumeTagCommand('/urgent', configured), {
        tagId: 'safety', value: '', cursor: 0
    });
    assert.equal(consumeTagCommand('/critical', configured), null);
});

test('selects a tag by id without disturbing the note', () => {
    assert.deepEqual(consumeTagCommand('Check this /lighting now', tags, 25), {
        tagId: 'lighting', value: 'Check this now', cursor: 15
    });
});

test('ignores incomplete and unknown commands', () => {
    assert.equal(consumeTagCommand('/crit', tags), null);
    assert.equal(consumeTagCommand('/urgent', tags), null);
    assert.equal(consumeTagCommand('critical', tags), null);
});

test('does not consume a command embedded in a word', () => {
    assert.equal(consumeTagCommand('not/critical', tags), null);
});

test('routes a standalone shitpost command to chat text', () => {
    assert.equal(consumeShitpostCommand('/shitpost this belongs in chat'), 'this belongs in chat');
    assert.equal(consumeShitpostCommand('/SHITPOST   with extra space'), 'with extra space');
    assert.equal(consumeShitpostCommand('before /shitpost after'), 'before after');
});

test('does not route an empty or embedded shitpost command', () => {
    assert.equal(consumeShitpostCommand('/shitpost'), null);
    assert.equal(consumeShitpostCommand('not/shitpost text'), null);
});