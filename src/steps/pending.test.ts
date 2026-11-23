import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ConfigLoad } from '../config/load.ts';
import { parseConfigText } from '../config/text.ts';
import type { ConfigMigration } from '../config/migrate.ts';
import { CONFIG_FORMAT_STEP, isStepBackupFile, pendingSteps, stepCommandOf, stepSourceOf, type StepSource } from './pending.ts';

const PATH = '/kit/config.json';
const ROSTER = { sessions: ['alpha'], roles: { lead: 'alpha' } };
const ADD_FLAG: readonly ConfigMigration[] = [
  { from: 1, firstRelease: '9.1.0', apply: (config) => ({ config: { ...config, flag: true }, changes: ['added flag'] }) },
];

function loadOf(text: string, migrations: readonly ConfigMigration[] = ADD_FLAG): ConfigLoad {
  return { ...parseConfigText(text, migrations, 2), path: PATH };
}

const OLDER = loadOf(JSON.stringify({ configVersion: 1, ...ROSTER }));

describe('pending steps', () => {
  it('lists the config format step for an older file, in plain words with its preview and the line to type', () => {
    assert.deepEqual(pendingSteps({ config: OLDER }), [
      {
        id: 'config-format',
        title: 'teamrig needs to update your team settings',
        why: 'the team settings file is in an older layout, so changing a setting is refused until it is updated; a backup is kept first',
        preview: ['v1→v2: added flag'],
        command: '/teamrig steps run config-format --yes',
      },
    ]);
  });

  it('names no format number or version in the title and why the person reads first', () => {
    const [step] = pendingSteps({ config: OLDER });
    assert.ok(step !== undefined);
    assert.doesNotMatch(`${step.title} ${step.why}`, /\d/);
  });

  it('lists nothing for a current, missing, unreadable or newer file', () => {
    const current = loadOf(JSON.stringify({ configVersion: 2, ...ROSTER }));
    const newer = loadOf(JSON.stringify({ configVersion: 9, ...ROSTER }));
    const unreadable = loadOf('{ not json');
    const missing: ConfigLoad = { status: 'missing', path: PATH };
    for (const config of [current, newer, unreadable, missing]) {
      assert.deepEqual(pendingSteps({ config }), [], config.status);
    }
  });

  it('keeps the sources order, so a later kind of step adds a row', () => {
    const always: StepSource = {
      id: 'later',
      pendingOf: () => ({ id: 'later', title: 'a later step', why: 'why', preview: [], command: stepCommandOf('later') }),
      isBackupFile: () => false,
    };
    assert.deepEqual(
      pendingSteps({ config: OLDER }, [always, CONFIG_FORMAT_STEP]).map((step) => step.id),
      ['later', 'config-format'],
    );
  });

  it('finds a source by its id', () => {
    assert.equal(stepSourceOf('config-format'), CONFIG_FORMAT_STEP);
    assert.equal(stepSourceOf('nothing'), undefined);
  });

  it("knows the config format step's backup names, plain and stamped, and no other file or step", () => {
    for (const name of ['config.v7.json', 'config.v12.202611221600.json', 'config.v7.202611221600-2.json']) {
      assert.equal(isStepBackupFile('config-format', name), true, name);
    }
    for (const name of ['config.json', 'config.mine.json', 'config.v7.json.bak', 'config.v7.2026.json', '..', 'notes.txt']) {
      assert.equal(isStepBackupFile('config-format', name), false, name);
    }
    assert.equal(isStepBackupFile('nothing', 'config.v7.json'), false);
  });
});
