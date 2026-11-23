import { isMigrationBackupFile } from "../config/load.js";
import { KIT_NAME } from "../core/home.js";
import { WRITE_SWITCH } from "../core/settings-writers.js";
/** What the person types to take the step `id`. */
export function stepCommandOf(id) {
    return `/${KIT_NAME} steps run ${id} --${WRITE_SWITCH}`;
}
const CONFIG_FORMAT = 'config-format';
/**
 * The config file is in an older format: every command reads it updated in memory, and a write is refused until it is
 * written. Its preview is the migration's own change lines.
 */
export const CONFIG_FORMAT_STEP = {
    id: CONFIG_FORMAT,
    pendingOf({ config }) {
        if (config.status !== 'loaded' || config.pending === undefined || config.newerVersion !== undefined) {
            return undefined;
        }
        return {
            id: CONFIG_FORMAT,
            title: `${KIT_NAME} needs to update your team settings`,
            why: `the team settings file is in an older layout, so changing a setting is refused until it is updated; a backup is kept first`,
            preview: config.pending.changes,
            command: stepCommandOf(CONFIG_FORMAT),
        };
    },
    isBackupFile: isMigrationBackupFile,
};
/** Every kind of step, in the order they are shown and taken. */
export const STEP_SOURCES = [CONFIG_FORMAT_STEP];
/** The steps pending now, in `sources` order. */
export function pendingSteps(inputs, sources = STEP_SOURCES) {
    return sources.flatMap((source) => {
        const step = source.pendingOf(inputs);
        return step === undefined ? [] : [step];
    });
}
/**
 * The lead's start line for each pending step: a step is the person's to take, so the lead tells them what it is and
 * what to type, and `steps` shows what it changes.
 */
export function startStepLines(steps) {
    return steps.map((step) => `STEP for the person: ${step.title}; they type: ${step.command} (${KIT_NAME} steps shows what it changes)`);
}
/** The source of the step `id`, or undefined when no kind of step has that id. */
export function stepSourceOf(id, sources = STEP_SOURCES) {
    return sources.find((source) => source.id === id);
}
/** Whether `name` is a backup file name of the step `id`; false for a step no source has. */
export function isStepBackupFile(id, name, sources = STEP_SOURCES) {
    return stepSourceOf(id, sources)?.isBackupFile(name) ?? false;
}
