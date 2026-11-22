import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG_MIGRATIONS, type ConfigFormat } from '../config/migrate.ts';
import { CONFIG_VERSION } from '../config/types.ts';
import { CliHarness, CONFIG_PATH, TEAM } from '../testing/cli-harness.ts';
import { writeConfigMigration } from './config-migration.ts';
import { openKit, requireConfig } from './kit.ts';

/** A release one config version ahead of this one, so this release's config is pending its migration. */
const NEXT_FORMAT: ConfigFormat = {
  version: CONFIG_VERSION + 1,
  migrations: [...CONFIG_MIGRATIONS, { from: CONFIG_VERSION, firstRelease: '9.0.0', apply: (config) => ({ config, changes: ['added a flag'] }) }],
};

/** A team opened while its config is pending the next format, and the runtime it was opened with. */
async function pendingTeam(): Promise<{ readonly harness: CliHarness; readonly write: () => ReturnType<typeof writeConfigMigration> }> {
  const harness = new CliHarness(TEAM);
  const runtime = harness.runtime({ configFormat: NEXT_FORMAT });
  const kit = await openKit(runtime, 'app');
  assert.notEqual(kit.load.status === 'loaded' ? kit.load.pending : undefined, undefined);
  return { harness, write: () => writeConfigMigration(runtime, kit, requireConfig(kit, runtime, 'read')) };
}

describe('writeConfigMigration', () => {
  it('writes the pending migration and keeps the old file as its backup', async () => {
    const { harness, write } = await pendingTeam();
    const before = harness.files.get(CONFIG_PATH);
    const written = await write();
    assert.equal(written.status, 'migrated');
    if (written.status !== 'migrated') return;
    assert.deepEqual(written.pending.changes, [`v${CONFIG_VERSION}→v${CONFIG_VERSION + 1}: added a flag`]);
    assert.equal(harness.files.get(written.backup), before);
    assert.match(harness.files.get(CONFIG_PATH) ?? '', new RegExp(`"configVersion": ${CONFIG_VERSION + 1}`));
  });

  it('writes nothing when another run migrated the config after the team was opened', async () => {
    const { harness, write } = await pendingTeam();
    const migrated = JSON.stringify({ ...TEAM, configVersion: CONFIG_VERSION + 1 });
    await harness.files.write(CONFIG_PATH, migrated);
    assert.deepEqual(await write(), { status: 'unchanged' });
    assert.equal(harness.files.get(CONFIG_PATH), migrated);
  });

  it('writes nothing when the config no longer loads under the lock', async () => {
    const { harness, write } = await pendingTeam();
    await harness.files.write(CONFIG_PATH, 'not json');
    assert.deepEqual(await write(), { status: 'unchanged' });
    assert.equal(harness.files.get(CONFIG_PATH), 'not json');
  });
});
