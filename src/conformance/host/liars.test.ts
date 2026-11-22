import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nothingModels, yesModels } from './models.ts';
import { nothingSteps, yesSteps } from './steps.ts';

/**
 * A contract's cases stop at a liar's first wrong answer, so they never ask it the rest. These hold each liar of the
 * models and steps contracts to every answer its comment promises, so a liar that drifts into an honest answer is
 * seen here rather than in a contract that no longer catches anything.
 */
describe('the models liars', () => {
  it('nothingModels takes no name, tells no model apart and names no step or note', () => {
    const { port, world } = nothingModels();
    assert.equal(port.defaultName, '');
    assert.deepEqual(port.aliases, []);
    assert.equal(port.problemOf(world.model), 'expected nothing');
    assert.equal(port.isOtherModel(world.model, world.otherModel), false);
    assert.equal(port.switchModelStep(world.model), '');
    assert.equal(port.switchEffortStep('high'), '');
    assert.equal(port.switchNoteOf(world.model), undefined);
  });

  it('yesModels takes every name, calls every running model another and has one fixed step and note', () => {
    const { port, world } = yesModels();
    assert.equal(port.problemOf('not a model'), undefined);
    assert.equal(port.isOtherModel(world.model, world.model), true);
    assert.equal(port.switchModelStep(world.model), port.switchModelStep(world.otherModel));
    assert.equal(port.switchEffortStep('low'), port.switchEffortStep('max'));
    assert.equal(port.switchNoteOf(world.model), 'always');
  });
});

describe('the steps liars', () => {
  it('nothingSteps names every step empty', () => {
    const { port, world } = nothingSteps();
    assert.deepEqual(
      [port.reloadPlugins, port.exit, port.pluginCommand(world.plugin), port.resume(world.session), port.updatePlugin(world.plugin, world.marketplace), port.updateHost],
      ['', '', '', '', '', ''],
    );
  });

  it('yesSteps names one fixed step for everything, naming nothing it acts on', () => {
    const { port, world } = yesSteps();
    const steps = [port.reloadPlugins, port.exit, port.pluginCommand(world.plugin), port.resume(world.session), port.updatePlugin(world.plugin, world.marketplace), port.updateHost];
    assert.deepEqual(new Set(steps), new Set(['do it']));
  });
});
