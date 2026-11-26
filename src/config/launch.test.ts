import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from '../testing/config.ts';
import { describeLaunch, isDefaultModel, isEffort, isModel, isTerminalName, launchModelProblem, launchOf, MODEL_NAME_MAX_LENGTH, ownLaunchOf, terminalOf } from './launch.ts';
import type { LaunchConfig } from './types.ts';

/** A host's lead default, as the CLI hands it in (src/cli/host.ts `leadLaunchOf`). */
const LEAD_DEFAULT: LaunchConfig = { model: 'opus', effort: 'xhigh' };

describe('isModel', () => {
  it("takes any host's model names: aliases, full ids with a date, provider or version part, and a window suffix", () => {
    for (const name of ['default', 'opus', 'best[1m]', 'claude-opus-5-5', 'claude-opus-4-1@20250805', 'claude-3.7-sonnet', 'gpt-5', 'Opus', 'openai/gpt-5:latest', 'llama3_70b']) {
      assert.equal(isModel(name), undefined, name);
    }
  });

  it('refuses a space, a leading mark, a window suffix in capitals, an empty name and one past the length cap', () => {
    for (const model of ['claude-opus 5', '-x', '[1m]', 'a[1M]', '', 'a'.repeat(MODEL_NAME_MAX_LENGTH + 1)]) {
      assert.match(isModel(model) ?? '', /^expected a model name: a letter or digit, then letters, digits or \. _ @ : \/ -, at most 100 characters$/, model);
    }
    assert.equal(isModel('a'.repeat(MODEL_NAME_MAX_LENGTH)), undefined);
  });
});

describe('launchModelProblem', () => {
  const host = { modelProblem: (model: string) => (model === 'gpt-5' ? 'not run here' : undefined) };

  it("gives the host's refusal of a launch's model, and nothing for one it runs", () => {
    assert.equal(launchModelProblem({ model: 'gpt-5', effort: 'high' }, host), 'not run here');
    assert.equal(launchModelProblem({ model: 'opus' }, host), undefined);
  });

  it('never asks the host about the default model, which is its own', () => {
    const refusesAll = { modelProblem: () => 'refused' };
    assert.equal(launchModelProblem({}, refusesAll), undefined);
    assert.equal(launchModelProblem({ model: 'default' }, refusesAll), undefined);
  });
});

describe('isEffort', () => {
  it('takes the five effort levels and refuses anything else', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      assert.equal(isEffort(level), undefined, level);
    }
    assert.equal(isEffort('auto'), 'expected one of low, medium, high, xhigh, max');
    assert.equal(isEffort('High'), 'expected one of low, medium, high, xhigh, max');
  });
});

describe('launchOf', () => {
  it("starts the lead on the host's lead default when nothing is set", () => {
    assert.deepEqual(launchOf(testConfig(), 'lead', LEAD_DEFAULT), { model: 'opus', effort: 'xhigh' });
  });

  it('leaves the lead to the host when the host gives no lead default', () => {
    assert.deepEqual(launchOf(testConfig(), 'lead', {}), {});
    assert.deepEqual(launchOf(testConfig({ launch: { lead: { effort: 'max' } } }), 'lead', {}), { effort: 'max' });
  });

  it('lets the lead set each key on its own and keeps the default for the other', () => {
    assert.deepEqual(launchOf(testConfig({ launch: { lead: { model: 'best' } } }), 'lead', LEAD_DEFAULT), { model: 'best', effort: 'xhigh' });
    assert.deepEqual(launchOf(testConfig({ launch: { lead: { effort: 'max' } } }), 'lead', LEAD_DEFAULT), { model: 'opus', effort: 'max' });
    assert.deepEqual(launchOf(testConfig({ launch: { lead: { model: 'default', effort: 'high' } } }), 'lead', LEAD_DEFAULT), { model: 'default', effort: 'high' });
  });

  it('leaves the other sessions to Claude Code unless they are set', () => {
    const config = testConfig({ launch: { alpha: { model: 'sonnet', effort: 'medium' } } });
    assert.deepEqual(launchOf(config, 'alpha', LEAD_DEFAULT), { model: 'sonnet', effort: 'medium' });
    assert.deepEqual(launchOf(config, 'bravo', LEAD_DEFAULT), {});
  });

  it('never reads an id from the object prototype', () => {
    assert.deepEqual(launchOf(testConfig(), 'constructor', LEAD_DEFAULT), {});
  });
});

describe('ownLaunchOf', () => {
  it("is what the config itself sets for the session, without the lead's defaults (T2440)", () => {
    const config = testConfig({ launch: { lead: { effort: 'high' }, alpha: { model: 'sonnet' } } });
    assert.deepEqual(ownLaunchOf(config, 'lead'), { effort: 'high' });
    assert.deepEqual(ownLaunchOf(config, 'alpha'), { model: 'sonnet' });
    assert.deepEqual(ownLaunchOf(testConfig(), 'lead'), {});
    assert.deepEqual(ownLaunchOf(testConfig(), 'constructor'), {});
  });
});

describe('terminalOf', () => {
  it("is the session's own terminal, else the team's open.terminal, never one read off the prototype (T5093)", () => {
    const config = testConfig({ open: { terminal: 'tmux' }, launch: { alpha: { terminal: 'headless' }, bravo: { effort: 'high' } } });
    assert.equal(terminalOf(config, 'alpha'), 'headless');
    assert.equal(terminalOf(config, 'bravo'), 'tmux');
    assert.equal(terminalOf(config, 'constructor'), 'tmux');
    assert.equal(terminalOf(testConfig(), 'alpha'), 'auto');
  });
});

describe('isTerminalName', () => {
  it('takes every terminal teamrig opens and refuses any other name', () => {
    assert.equal(isTerminalName('headless'), undefined);
    assert.match(isTerminalName('xterm') ?? '', /^expected one of auto, tmux, .*, headless, print$/);
  });
});

describe('isDefaultModel', () => {
  it('is true only for no model or the default alias', () => {
    assert.equal(isDefaultModel(undefined), true);
    assert.equal(isDefaultModel('default'), true);
    assert.equal(isDefaultModel('best'), false);
  });
});

describe('describeLaunch', () => {
  it('names the model and the effort, or says each is the default', () => {
    assert.equal(describeLaunch({ model: 'best', effort: 'xhigh' }), 'model best at xhigh effort');
    assert.equal(describeLaunch({ model: 'sonnet' }), 'model sonnet at the default effort');
    assert.equal(describeLaunch({ effort: 'high' }), 'the default model at high effort');
    assert.equal(describeLaunch({ model: 'default', effort: 'low' }), 'the default model at low effort');
    assert.equal(describeLaunch({}), 'the default model and effort');
  });
});
