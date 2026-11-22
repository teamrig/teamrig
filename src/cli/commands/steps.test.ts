import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CONFIG_MIGRATIONS, type ConfigFormat } from '../../config/migrate.ts';
import { CONFIG_VERSION } from '../../config/types.ts';
import { settingsWriteRefusal } from '../../core/settings-writers.ts';
import { STEP_SOURCES } from '../../steps/pending.ts';
import { CliHarness, CONFIG_PATH, TEAM, TEAM_HOME } from '../../testing/cli-harness.ts';
import { EXIT } from '../runtime.ts';
import { STEP_RUNS } from './steps.ts';

/** A release one config version ahead of this one, so this release's config is pending its format step. */
const NEXT_FORMAT: ConfigFormat = {
  version: CONFIG_VERSION + 1,
  migrations: [...CONFIG_MIGRATIONS, { from: CONFIG_VERSION, firstRelease: '9.0.0', apply: (config) => ({ config, changes: ['added a flag'] }) }],
};
const CURRENT_TEAM = { ...TEAM, configVersion: CONFIG_VERSION };
const BACKUPS = join(TEAM_HOME, 'backups');
const LEDGER = join(TEAM_HOME, 'state', 'step-backups.jsonl');
const BACKUP = join(BACKUPS, `config.v${CONFIG_VERSION}.json`);
const TITLE = 'teamrig needs to update your team settings';
const CHANGE = `  v${CONFIG_VERSION}→v${CONFIG_VERSION + 1}: added a flag`;

describe('teamrig steps', () => {
  it('names no step for a current config', async () => {
    const result = await new CliHarness(CURRENT_TEAM).run(['steps']);
    assert.deepEqual([result.code, result.stdout], [EXIT.ok, ['NONE teamrig needs no step from you']]);
  });

  it('lists the config format step in plain words, with its change and what to type', async () => {
    const result = await new CliHarness(CURRENT_TEAM).run(['steps'], { configFormat: NEXT_FORMAT });
    assert.deepEqual(
      [result.code, result.stdout],
      [
        EXIT.ok,
        [
          `STEP config-format: ${TITLE}`,
          '  why: the team settings file is in an older layout, so changing a setting is refused until it is updated; a backup is kept first',
          CHANGE,
          '  take it: /teamrig steps run config-format --yes',
        ],
      ],
    );
  });

  it('has a way to take every kind of step', () => {
    assert.deepEqual(STEP_SOURCES.map((source) => STEP_RUNS.has(source.id)), STEP_SOURCES.map(() => true));
  });
});

describe('teamrig steps run', () => {
  it('previews the step and where its backup goes, changing nothing', async () => {
    const kit = new CliHarness(CURRENT_TEAM);
    const before = kit.files.get(CONFIG_PATH);
    const result = await kit.run(['steps', 'run', 'config-format'], { configFormat: NEXT_FORMAT });
    assert.deepEqual(
      [result.code, result.stdout],
      [
        EXIT.ok,
        [
          `PREVIEW ${TITLE}; nothing changed`,
          CHANGE,
          `NOTE a backup goes to ${BACKUPS} first and stays until this step runs again. Take it: /teamrig steps run config-format --yes`,
        ],
      ],
    );
    assert.deepEqual([kit.files.get(CONFIG_PATH), kit.files.get(LEDGER)], [before, undefined]);
  });

  it('takes the step with --yes after a backup, records the backup, and a later run removes it', async () => {
    const kit = new CliHarness(CURRENT_TEAM);
    const before = kit.files.get(CONFIG_PATH);
    const done = await kit.run(['steps', 'run', 'config-format', '--yes'], { configFormat: NEXT_FORMAT });
    assert.deepEqual([done.code, done.stdout], [EXIT.ok, [`DONE ${TITLE}; the backup is at ${BACKUP}`, CHANGE]]);
    assert.equal(kit.files.get(BACKUP), before);
    assert.match(kit.files.get(CONFIG_PATH) ?? '', new RegExp(`"configVersion": ${CONFIG_VERSION + 1}`));
    assert.deepEqual(JSON.parse(kit.files.get(LEDGER) ?? ''), { v: 1, step: 'config-format', path: BACKUP, at: '2030-01-08T10:00:00.000Z' });

    const again = await kit.run(['steps', 'run', 'config-format', '--yes'], { configFormat: NEXT_FORMAT });
    assert.deepEqual(again.stdout, ['UNCHANGED config-format is not needed now']);

    const twoAhead: ConfigFormat = {
      version: CONFIG_VERSION + 2,
      migrations: [...NEXT_FORMAT.migrations, { from: CONFIG_VERSION + 1, firstRelease: '9.1.0', apply: (config) => ({ config, changes: ['added another'] }) }],
    };
    const next = await kit.run(['steps', 'run', 'config-format', '--yes'], { configFormat: twoAhead });
    const nextBackup = join(BACKUPS, `config.v${CONFIG_VERSION + 1}.json`);
    assert.deepEqual(next.stdout, [
      `DONE ${TITLE}; the backup is at ${nextBackup}`,
      `  v${CONFIG_VERSION + 1}→v${CONFIG_VERSION + 2}: added another`,
      `REMOVED the earlier backup ${BACKUP}`,
    ]);
    assert.equal(kit.files.get(BACKUP), undefined);
  });

  it('says a step not needed now is unchanged, and refuses a step it has no kind of', async () => {
    const kit = new CliHarness(CURRENT_TEAM);
    assert.deepEqual((await kit.run(['steps', 'run', 'config-format', '--yes'])).stdout, ['UNCHANGED config-format is not needed now']);
    const unknown = await kit.run(['steps', 'run', 'reboot']);
    assert.deepEqual([unknown.code, unknown.stdout], [EXIT.refused, ['REFUSED no step reboot; teamrig steps lists those pending']]);
    assert.equal((await kit.run(['steps', 'run'])).code, EXIT.usage);
  });

  it('refuses --yes where an agent runs it, before it writes, and still previews there', async () => {
    const kit = new CliHarness(CURRENT_TEAM);
    const before = kit.files.get(CONFIG_PATH);
    const env = { CLAUDECODE: '1' };
    const refused = await kit.run(['steps', 'run', 'config-format', '--yes'], { configFormat: NEXT_FORMAT, env });
    assert.deepEqual([refused.code, refused.stdout], [EXIT.refused, [`REFUSED ${settingsWriteRefusal('steps run', 'CLAUDECODE')}`]]);
    assert.equal(kit.files.get(CONFIG_PATH), before);
    const preview = await kit.run(['steps', 'run', 'config-format'], { configFormat: NEXT_FORMAT, env });
    assert.equal(preview.code, EXIT.ok);
  });
});

describe("the lead's start names each step the person must take", () => {
  const LINE = `STEP for the person: ${TITLE}; they type: /teamrig steps run config-format --yes (teamrig steps shows what it changes)`;

  it('prints a line per pending step at the lead start, none at another session start or with nothing pending', async () => {
    const kit = new CliHarness(CURRENT_TEAM);
    const lead = await kit.run(['start', '--session', 'lead'], { configFormat: NEXT_FORMAT });
    assert.equal(lead.code, EXIT.ok, lead.stdout.join('\n'));
    assert.ok(lead.stdout.includes(LINE), lead.stdout.join('\n'));
    const other = await kit.run(['start', '--session', 'alpha'], { configFormat: NEXT_FORMAT });
    assert.ok(!other.stdout.some((line) => line.startsWith('STEP ')), other.stdout.join('\n'));
    const current = await kit.run(['start', '--session', 'lead']);
    assert.ok(!current.stdout.some((line) => line.startsWith('STEP ')), current.stdout.join('\n'));
  });
});
