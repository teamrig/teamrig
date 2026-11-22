import assert from 'node:assert/strict';
import { defineContract } from "../contract.js";
/** teamrig's own effort scale, which a host's steps switch between and the lead's default is one of. */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Names no host takes as a model. */
const NOT_MODELS = ['', 'not a model', 'opus; rm -rf /'];
const CASES = [
    {
        id: 'models.names',
        title: 'takes its aliases, its default name and a full model id, and says why for a name it does not take',
        features: ['sessions.open'],
        run: ({ port, world }) => {
            assert.notEqual(port.defaultName.trim(), '', 'the default name is empty');
            assert.ok(port.aliases.includes(port.defaultName), 'the default name is not among the aliases');
            for (const name of [...port.aliases, world.model, world.otherModel]) {
                assert.equal(port.problemOf(name), undefined, `${name} is refused`);
            }
            for (const name of NOT_MODELS) {
                const problem = port.problemOf(name);
                assert.ok(problem !== undefined && problem.trim() !== '', `${JSON.stringify(name)} is taken as a model`);
            }
        },
    },
    {
        id: 'models.lead-default',
        title: "starts the lead on a model it takes, never the host's own choice, at one of teamrig's effort levels",
        features: ['sessions.open'],
        run: ({ port }) => {
            const { model, effort } = port.leadDefault;
            assert.equal(port.problemOf(model), undefined, `the lead's model ${model} is refused`);
            assert.notEqual(model, port.defaultName, "the lead's model leaves the choice to the host");
            assert.ok(EFFORT_LEVELS.some((level) => level === effort), `the lead's effort ${effort} is not one of ${EFFORT_LEVELS.join(', ')}`);
        },
    },
    {
        id: 'models.other-model',
        title: 'tells a running model that is clearly not the one asked for, and never calls one it cannot place wrong',
        features: ['sessions.open'],
        run: ({ port, world }) => {
            assert.equal(port.isOtherModel(world.model, world.model), false, 'the model asked for is called another');
            assert.equal(port.isOtherModel(world.model, world.otherModel), true, `${world.otherModel} is taken for ${world.model}`);
            assert.equal(port.isOtherModel(world.otherModel, world.model), true, `${world.model} is taken for ${world.otherModel}`);
            assert.equal(port.isOtherModel(world.model, world.unplaced), false, `${world.unplaced}, which the host cannot place, is called wrong`);
        },
    },
    {
        id: 'models.switch-steps',
        title: 'names the step a person types to switch to each model and effort level, each step naming what it switches to',
        features: ['sessions.open'],
        run: ({ port, world }) => {
            for (const model of [world.model, world.otherModel, port.leadDefault.model]) {
                assert.ok(port.switchModelStep(model).includes(model), `the step to ${model} does not name it`);
            }
            assert.notEqual(port.switchModelStep(world.model), port.switchModelStep(world.otherModel), 'two models share one step');
            for (const effort of EFFORT_LEVELS) {
                assert.ok(port.switchEffortStep(effort).includes(effort), `the step to ${effort} effort does not name it`);
            }
            assert.notEqual(port.switchEffortStep('low'), port.switchEffortStep('max'), 'two effort levels share one step');
        },
    },
];
/** The liars' world: ids no liar's fixed answer equals. */
const WORLD = { model: 'model-one', otherModel: 'model-two', unplaced: 'model-unknown' };
/** A liar that claims the port and knows nothing: it takes no name, tells no model apart and names no step. */
export function nothingModels() {
    return {
        world: WORLD,
        port: {
            defaultName: '',
            aliases: [],
            problemOf: () => 'expected nothing',
            leadDefault: { model: '', effort: '' },
            isOtherModel: () => false,
            switchModelStep: () => '',
            switchEffortStep: () => '',
            switchNoteOf: () => undefined,
        },
    };
}
/** A liar that says yes to all: it takes every name, calls every running model another and has one fixed step. */
export function yesModels() {
    return {
        world: WORLD,
        port: {
            defaultName: 'any',
            aliases: ['any'],
            problemOf: () => undefined,
            leadDefault: { model: 'any', effort: 'any' },
            isOtherModel: () => true,
            switchModelStep: () => 'switch',
            switchEffortStep: () => 'switch',
            switchNoteOf: () => 'always',
        },
    };
}
/** What every host's models port must do with the names a session's launch holds and the steps that switch it. */
export const MODELS_CONTRACT = defineContract({
    port: 'models',
    side: 'host',
    cases: CASES,
    liars: [nothingModels, yesModels],
});
