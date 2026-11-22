import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionStartOf } from './session-start.ts';

const REST = { name: 'app-alpha', resume: undefined, settingsFile: undefined, prompt: 'Go on' };

describe('sessionStartOf', () => {
  it('names the model and the effort that are set, with what the start adds', () => {
    assert.deepEqual(sessionStartOf({ model: 'best', effort: 'xhigh' }, REST), { ...REST, model: 'best', effort: 'xhigh' });
    assert.deepEqual(sessionStartOf({ model: 'claude-opus-5-5[1m]' }, REST), { ...REST, model: 'claude-opus-5-5[1m]', effort: undefined });
    const resumed = { name: 'app-alpha', resume: 'abc', settingsFile: '/state/launch/alpha.settings.json', prompt: undefined };
    assert.deepEqual(sessionStartOf({ effort: 'low' }, resumed), { ...resumed, model: undefined, effort: 'low' });
  });

  it("names no model for an unset one or teamrig's own default word, which no host knows", () => {
    assert.deepEqual(sessionStartOf({}, REST), { ...REST, model: undefined, effort: undefined });
    assert.deepEqual(sessionStartOf({ model: 'default', effort: 'high' }, REST), { ...REST, model: undefined, effort: 'high' });
  });
});
