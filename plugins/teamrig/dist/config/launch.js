import { EFFORT_LEVELS, isEffortLevel } from "./types.js";
/** Leaves the model to Claude Code: `launch` passes no `--model` for it. */
export const DEFAULT_MODEL_ALIAS = 'default';
/**
 * The shape of a model name any host could take: an alias or a full id, with a provider or date part and an optional
 * bracketed window suffix such as `[1m]`. Which names a host really runs is its models port's `problemOf`, asked
 * where a name is used (hire, open, doctor), so a team config loads on every host.
 */
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@:/-]*(?:\[[a-z0-9]+\])?$/;
export const MODEL_NAME_MAX_LENGTH = 100;
export const isModel = (model) => model.length <= MODEL_NAME_MAX_LENGTH && MODEL_NAME_PATTERN.test(model)
    ? undefined
    : `expected a model name: a letter or digit, then letters, digits or . _ @ : / -, at most ${MODEL_NAME_MAX_LENGTH} characters`;
export const isEffort = (effort) => (isEffortLevel(effort) ? undefined : `expected one of ${EFFORT_LEVELS.join(', ')}`);
/**
 * What the team config itself sets for the session (`launch.<id>`), without the lead's defaults: the restore reopens a
 * session on an effort set here, and on the level it last ran at otherwise (T2440).
 */
export function ownLaunchOf(config, id) {
    // By its own keys only, so an id such as `constructor` never reads the object's prototype.
    return Object.entries(config.launch).find(([key]) => key === id)?.[1] ?? {};
}
/**
 * The model and effort a session starts on: its own `launch` entry, and for the lead `leadDefault` (the host's lead
 * default, src/cli/host.ts `leadLaunchOf`) under each key the entry leaves unset. Other sessions leave unset keys to
 * the host.
 */
export function launchOf(config, id, leadDefault) {
    const own = ownLaunchOf(config, id);
    return config.roles.lead === id ? { ...leadDefault, ...own } : own;
}
/**
 * Why a launch's model will not run on the host, or undefined: a name of the right shape the host refuses, such as
 * another provider's model. The default model is the host's own, so it always runs.
 */
export function launchModelProblem(launch, host) {
    return isDefaultModel(launch.model) ? undefined : host.modelProblem(launch.model);
}
/** True when the settings leave the model to Claude Code. */
export function isDefaultModel(model) {
    return model === undefined || model === DEFAULT_MODEL_ALIAS;
}
/** The settings in words, such as "model best at xhigh effort", for the lines a person reads. */
export function describeLaunch(settings) {
    const { model, effort } = settings;
    if (isDefaultModel(model)) {
        return effort === undefined ? 'the default model and effort' : `the default model at ${effort} effort`;
    }
    return `model ${model} at ${effort ?? 'the default'} effort`;
}
