import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nothingLauncher, yesLauncher } from './launcher.ts';
import { nothingModels, yesModels } from './models.ts';
import { nothingSteps, yesSteps } from './steps.ts';

/**
 * A contract's cases stop at a liar's first wrong answer, so they never ask it the rest. These hold each liar of the
 * launcher, models and steps contracts to every answer its comment promises, so a liar that drifts into an honest
 * answer is seen here rather than in a contract that no longer catches anything.
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
    assert.deepEqual(port.routingOverrides, []);
  });

  it('yesModels takes every name, calls every running model another and has one fixed step and note', () => {
    const { port, world } = yesModels();
    assert.equal(port.problemOf('not a model'), undefined);
    assert.equal(port.isOtherModel(world.model, world.model), true);
    assert.equal(port.switchModelStep(world.model), port.switchModelStep(world.otherModel));
    assert.equal(port.switchEffortStep('low'), port.switchEffortStep('max'));
    assert.equal(port.switchNoteOf(world.model), 'always');
    assert.deepEqual(port.routingOverrides.map(({ variable }) => variable), ['ANY', 'ANY']);
    assert.deepEqual(port.routingOverrides.map(({ effect }) => effect('high')), ['always', 'always']);
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

describe('the launcher liars', () => {
  it('nothingLauncher names nothing, passes no argument, tells no part of a run and owns no process, fork or job', () => {
    const { port, world } = nothingLauncher();
    const launcher = port(world.env({ sessionId: 'session-one', forcedEffort: 'high' }));
    assert.deepEqual([launcher.programName, launcher.program], ['', '']);
    assert.deepEqual(launcher.launchArgs({ name: 'n', model: 'm', effort: 'e', resume: 'r', settingsFile: 's', prompt: 'p' }), []);
    assert.deepEqual(Object.values(launcher.identity()), [undefined, undefined, undefined, undefined, undefined]);
    assert.deepEqual([launcher.variables.marks, launcher.variables.identity, launcher.childEnv.session], [[], [], []]);
    assert.equal(launcher.isSessionProcess(world.sessionProcess), false);
    assert.equal(launcher.isForkOf(world.forkOf('session-one'), 'session-one'), false);
    assert.equal(launcher.backgroundJobSession(world.backgroundJob('session-one')), undefined);
  });

  it('yesLauncher tells one fixed run whatever it is told, starts every session alike and owns every process, fork and job', () => {
    const { port, world } = yesLauncher();
    assert.deepEqual(port(world.env({ sessionId: 'session-one' })).identity(), port({}).identity());
    const launcher = port({});
    assert.deepEqual(launcher.launchArgs({ name: undefined, model: 'one', effort: undefined, resume: undefined, settingsFile: undefined, prompt: undefined }), launcher.launchArgs({ name: undefined, model: 'two', effort: undefined, resume: undefined, settingsFile: undefined, prompt: undefined }));
    assert.equal(launcher.isSessionProcess({ name: 'anything', commandLine: '' }), true);
    assert.equal(launcher.isForkOf('', 'session-one'), true);
    assert.equal(launcher.backgroundJobSession([]), launcher.backgroundJobSession(world.backgroundJob('session-one')));
  });
});
