// What a team calls each level of its work in what teamrig prints (design #2253 piece B4, T5205): a preset of a
// tracker's own words, or the team's or one person's own map. Names change labels only: commands, fields, the
// register and every spec keep the neutral level words below, so a team that renames "feature" to "epic" types and
// stores the same thing as one that does not.
import { isRecord } from "../core/guards.js";
import { shortLine } from "../config/reader.js";
/** The levels a name is given for, from the widest down; the words commands and fields use. */
export const NAMED_LEVELS = ['goal', 'feature', 'task', 'subtask'];
function named(singular, plural) {
    return { singular, plural };
}
/**
 * `default` is teamrig's own neutral set; every other preset is a tracker's own words, each checked against its
 * platform's docs when it landed (11-25).
 */
export const LEVEL_PRESETS = {
    default: { goal: named('Goal', 'Goals'), feature: named('Feature', 'Features'), task: named('Task', 'Tasks'), subtask: named('Subtask', 'Subtasks') },
    youtrack: { goal: named('Epic', 'Epics'), feature: named('User Story', 'User Stories'), task: named('Task', 'Tasks'), subtask: named('Subtask', 'Subtasks') },
    jira: { goal: named('Initiative', 'Initiatives'), feature: named('Epic', 'Epics'), task: named('Story', 'Stories'), subtask: named('Sub-task', 'Sub-tasks') },
    'azure-devops': {
        goal: named('Epic', 'Epics'),
        feature: named('Feature', 'Features'),
        task: named('User Story', 'User Stories'),
        subtask: named('Task', 'Tasks'),
    },
    linear: { goal: named('Initiative', 'Initiatives'), feature: named('Project', 'Projects'), task: named('Issue', 'Issues'), subtask: named('Sub-issue', 'Sub-issues') },
    github: { goal: named('Milestone', 'Milestones'), feature: named('Feature', 'Features'), task: named('Issue', 'Issues'), subtask: named('Sub-issue', 'Sub-issues') },
    asana: { goal: named('Goal', 'Goals'), feature: named('Project', 'Projects'), task: named('Task', 'Tasks'), subtask: named('Subtask', 'Subtasks') },
    clickup: { goal: named('Goal', 'Goals'), feature: named('List', 'Lists'), task: named('Task', 'Tasks'), subtask: named('Subtask', 'Subtasks') },
};
export const LEVEL_PRESET_NAMES = ['default', 'youtrack', 'jira', 'azure-devops', 'linear', 'github', 'asana', 'clickup'];
/** The set shown when nothing names one: no key, `auto` with no tracker that names its levels. */
export const DEFAULT_LEVEL_PRESET = 'default';
/** `auto`: the team's tracker connector's names when it declares them, else the default set. */
export const AUTO_LEVEL_NAMES = 'auto';
/** The longest label printed; one line, so a name never breaks a row. */
export const MAX_LEVEL_LABEL = 40;
const isLabel = shortLine(MAX_LEVEL_LABEL);
export function isLevelPreset(value) {
    return LEVEL_PRESET_NAMES.some((preset) => preset === value);
}
/**
 * Reads a `levels.names` value at `path`: `auto`, a preset, or a map naming each of NAMED_LEVELS with a `singular`
 * and a `plural`. Undefined for a value left out or one refused; a refused one is an issue on `read`.
 */
export function readLevelNamesSetting(read, value, path) {
    if (value === undefined)
        return undefined;
    if (value === AUTO_LEVEL_NAMES || isLevelPreset(value))
        return value;
    if (typeof value === 'string') {
        read.report(path, `expected "${AUTO_LEVEL_NAMES}", one of ${LEVEL_PRESET_NAMES.join(', ')} or a map of each level, got ${JSON.stringify(value)}`);
        return undefined;
    }
    if (!isRecord(value)) {
        read.report(path, 'expected a preset name or a map of each level');
        return undefined;
    }
    for (const key of Object.keys(value)) {
        if (!NAMED_LEVELS.some((level) => level === key))
            read.report(`${path}.${key}`, `is no level; the levels are ${NAMED_LEVELS.join(', ')}`);
    }
    const names = {};
    for (const level of NAMED_LEVELS) {
        const at = `${path}.${level}`;
        const entry = value[level];
        if (!isRecord(entry)) {
            read.report(at, entry === undefined ? 'is required: a map names every level' : 'expected an object with singular and plural');
            continue;
        }
        const before = read.issues.length;
        const singular = read.requiredString(entry, 'singular', at, isLabel);
        const plural = read.requiredString(entry, 'plural', at, isLabel);
        if (read.issues.length === before)
            names[level] = { singular, plural };
    }
    const { goal, feature, task, subtask } = names;
    return goal === undefined || feature === undefined || task === undefined || subtask === undefined ? undefined : { goal, feature, task, subtask };
}
/** The names a setting gives, with `connector` the team's tracker's own (null when it declares none). */
function namesOf(setting, connector) {
    if (setting === AUTO_LEVEL_NAMES)
        return connector ?? LEVEL_PRESETS[DEFAULT_LEVEL_PRESET];
    return typeof setting === 'string' ? LEVEL_PRESETS[setting] : setting;
}
/** The names this person's output shows: their own setting, else the team's. */
export function levelNamesOf({ team, user, connector }) {
    return namesOf(user ?? team, connector);
}
/** The label for `count` items at `level`: the singular for exactly one, else the plural. */
export function levelLabel(names, level, count = 1) {
    return count === 1 ? names[level].singular : names[level].plural;
}
