import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostModels } from './models.ts';

const FABLE = 'claude-fable-5';
const OPUS = 'claude-opus-5-5';

describe('the Claude Code models', () => {
  it('takes every documented alias, the default among them', () => {
    assert.equal(hostModels.defaultName, 'default');
    assert.deepEqual(hostModels.aliases, ['default', 'best', 'fable', 'opus', 'sonnet', 'haiku', 'opusplan', 'fable[1m]', 'opus[1m]', 'sonnet[1m]', 'opusplan[1m]']);
    for (const alias of hostModels.aliases) {
      assert.equal(hostModels.problemOf(alias), undefined, alias);
    }
  });

  it('takes a full model id starting claude-, with or without the 1M window', () => {
    for (const id of [OPUS, 'claude-sonnet-5-5-20261001', 'claude-opus-5-5[1m]', 'claude-haiku-5.5@20261001']) {
      assert.equal(hostModels.problemOf(id), undefined, id);
    }
  });

  it('refuses another name, a wrong case and an id past 100 characters', () => {
    for (const model of ['gpt-5', 'Opus', 'claude-', `claude-${'a'.repeat(94)}`, 'opus[2m]']) {
      assert.match(hostModels.problemOf(model) ?? '', /^expected a model alias \(default, best, .*\) or a model id starting claude-$/, model);
    }
  });

  it('starts the lead on Opus at xhigh, never on the dearest model', () => {
    assert.deepEqual(hostModels.leadDefault, { model: 'opus', effort: 'xhigh' });
  });

  it('matches a family alias by family, and a full id with a date or provider wrapping', () => {
    assert.equal(hostModels.isOtherModel('opus', OPUS), false);
    assert.equal(hostModels.isOtherModel('sonnet', 'claude-sonnet-5-5'), false);
    assert.equal(hostModels.isOtherModel('opus[1m]', 'claude-haiku-5-5'), true);
    assert.equal(hostModels.isOtherModel(OPUS, 'us.anthropic.claude-opus-5-5-v1:0'), false);
    assert.equal(hostModels.isOtherModel('claude-opus-5-5-20261001', OPUS), false);
    assert.equal(hostModels.isOtherModel('claude-opus-4-6', OPUS), true);
  });

  it('runs best on Fable and opusplan on Opus or Sonnet', () => {
    assert.equal(hostModels.isOtherModel('best', FABLE), false);
    assert.equal(hostModels.isOtherModel('best', `${FABLE}[1m]`), false);
    assert.equal(hostModels.isOtherModel('best', OPUS), true);
    assert.equal(hostModels.isOtherModel('opusplan', OPUS), false);
    assert.equal(hostModels.isOtherModel('opusplan', 'claude-sonnet-5-5'), false);
    assert.equal(hostModels.isOtherModel('opusplan', 'claude-haiku-5-5'), true);
  });

  it('never calls a model of no known family wrong, nor anything against the default', () => {
    assert.equal(hostModels.isOtherModel('best', 'my-gateway-model'), false);
    assert.equal(hostModels.isOtherModel('default', OPUS), false);
  });

  it('names the steps that switch a session, and the note beside best', () => {
    assert.equal(hostModels.switchModelStep('opus'), '/model opus');
    assert.equal(hostModels.switchEffortStep('max'), '/effort max');
    assert.equal(hostModels.switchNoteOf('best'), 'if this account has no Fable, best is Opus and nothing needs changing');
    assert.equal(hostModels.switchNoteOf('opus'), undefined);
  });
});
