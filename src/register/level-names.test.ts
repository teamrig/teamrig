import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigReader, formatIssue } from '../config/reader.ts';
import {
  DEFAULT_LEVEL_PRESET,
  LEVEL_PRESET_NAMES,
  LEVEL_PRESETS,
  levelLabel,
  levelNamesOf,
  NAMED_LEVELS,
  readLevelNamesSetting,
  type LevelNames,
} from './level-names.ts';

const OWN: LevelNames = {
  goal: { singular: 'Theme', plural: 'Themes' },
  feature: { singular: 'Epic', plural: 'Epics' },
  task: { singular: 'Ticket', plural: 'Tickets' },
  subtask: { singular: 'Step', plural: 'Steps' },
};

function readValue(value: unknown): { setting: ReturnType<typeof readLevelNamesSetting>; issues: string[] } {
  const read = new ConfigReader();
  const setting = readLevelNamesSetting(read, value, 'levels.names');
  return { setting, issues: read.issues.map(formatIssue) };
}

describe('LEVEL_PRESETS', () => {
  it("ships teamrig's default set and the seven trackers the design names, each naming every level", () => {
    assert.deepEqual(LEVEL_PRESET_NAMES, ['default', 'youtrack', 'jira', 'azure-devops', 'linear', 'github', 'asana', 'clickup']);
    assert.deepEqual(Object.keys(LEVEL_PRESETS).sort(), [...LEVEL_PRESET_NAMES].sort());
    for (const preset of LEVEL_PRESET_NAMES) assert.deepEqual(Object.keys(LEVEL_PRESETS[preset]), [...NAMED_LEVELS]);
  });

  it('holds each tracker’s own words', () => {
    const words = (preset: keyof typeof LEVEL_PRESETS): string[] => NAMED_LEVELS.map((level) => LEVEL_PRESETS[preset][level].singular);
    assert.deepEqual(words('default'), ['Goal', 'Feature', 'Task', 'Subtask']);
    assert.deepEqual(words('youtrack'), ['Epic', 'User Story', 'Task', 'Subtask']);
    assert.deepEqual(words('jira'), ['Initiative', 'Epic', 'Story', 'Sub-task']);
    assert.deepEqual(words('azure-devops'), ['Epic', 'Feature', 'User Story', 'Task']);
    assert.deepEqual(words('linear'), ['Initiative', 'Project', 'Issue', 'Sub-issue']);
    assert.deepEqual(words('github'), ['Milestone', 'Feature', 'Issue', 'Sub-issue']);
    assert.deepEqual(words('asana'), ['Goal', 'Project', 'Task', 'Subtask']);
    assert.deepEqual(words('clickup'), ['Goal', 'List', 'Task', 'Subtask']);
  });

  it("defaults to teamrig's own set, not any tracker's", () => {
    assert.equal(DEFAULT_LEVEL_PRESET, 'default');
  });
});

describe('readLevelNamesSetting', () => {
  it('reads nothing as unset', () => {
    assert.deepEqual(readValue(undefined), { setting: undefined, issues: [] });
  });

  it('reads auto and each preset name', () => {
    assert.deepEqual(readValue('auto'), { setting: 'auto', issues: [] });
    for (const preset of LEVEL_PRESET_NAMES) assert.deepEqual(readValue(preset), { setting: preset, issues: [] });
  });

  it('reads a map naming every level', () => {
    assert.deepEqual(readValue(OWN), { setting: OWN, issues: [] });
  });

  it('refuses an unknown preset, naming the ones there are', () => {
    const { setting, issues } = readValue('trello');
    assert.equal(setting, undefined);
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /^levels\.names: expected "auto", one of default, youtrack, jira, azure-devops, linear, github, asana, clickup or a map of each level, got "trello"$/);
  });

  it('refuses a value that is neither a name nor a map', () => {
    assert.deepEqual(readValue(3), { setting: undefined, issues: ['levels.names: expected a preset name or a map of each level'] });
  });

  it('refuses a map missing a level, an unknown level, or a level that is no object', () => {
    const { goal, feature, task } = OWN;
    assert.deepEqual(readValue({ goal, feature, task }), { setting: undefined, issues: ['levels.names.subtask: is required: a map names every level'] });
    assert.deepEqual(readValue({ ...OWN, story: OWN.task }).issues, ['levels.names.story: is no level; the levels are goal, feature, task, subtask']);
    assert.deepEqual(readValue({ ...OWN, task: 'Ticket' }), { setting: undefined, issues: ['levels.names.task: expected an object with singular and plural'] });
  });

  it('refuses a level missing a form, or a label too long or on two lines', () => {
    assert.deepEqual(readValue({ ...OWN, goal: { singular: 'Theme' } }).issues, ['levels.names.goal.plural: is required']);
    const long = 'x'.repeat(41);
    assert.match(readValue({ ...OWN, goal: { singular: long, plural: 'Themes' } }).issues[0] ?? '', /^levels\.names\.goal\.singular: expected at most 40 characters/);
    assert.match(readValue({ ...OWN, goal: { singular: 'Two\nlines', plural: 'Themes' } }).issues[0] ?? '', /^levels\.names\.goal\.singular: expected a single line/);
  });
});

describe('levelNamesOf', () => {
  it('reads auto as the connector’s names, else the default set', () => {
    assert.deepEqual(levelNamesOf({ team: 'auto', user: null, connector: OWN }), OWN);
    assert.deepEqual(levelNamesOf({ team: 'auto', user: null, connector: null }), LEVEL_PRESETS.default);
  });

  it('reads a preset or a map as itself, ahead of the connector', () => {
    assert.deepEqual(levelNamesOf({ team: 'jira', user: null, connector: OWN }), LEVEL_PRESETS.jira);
    assert.deepEqual(levelNamesOf({ team: OWN, user: null, connector: null }), OWN);
  });

  it('lets the person’s own setting win over the team’s', () => {
    assert.deepEqual(levelNamesOf({ team: 'jira', user: 'linear', connector: null }), LEVEL_PRESETS.linear);
    assert.deepEqual(levelNamesOf({ team: 'jira', user: 'auto', connector: OWN }), OWN);
  });
});

describe('levelLabel', () => {
  it('says the singular for one and the plural otherwise', () => {
    assert.equal(levelLabel(LEVEL_PRESETS.jira, 'feature'), 'Epic');
    assert.equal(levelLabel(LEVEL_PRESETS.jira, 'feature', 1), 'Epic');
    assert.equal(levelLabel(LEVEL_PRESETS.jira, 'feature', 0), 'Epics');
    assert.equal(levelLabel(LEVEL_PRESETS.jira, 'task', 3), 'Stories');
  });
});
