import { migrationBackupName } from '../config/load.ts';
import type { PendingMigration } from '../config/text.ts';
import type { KitConfig } from '../config/types.ts';
import { configLockOf, reloadTeamConfig, type Kit } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

/** What writing the config's migration did: nothing, as none was pending, or the write and where the old file went. */
export type MigrationWrite =
  | { readonly status: 'unchanged' }
  | { readonly status: 'migrated'; readonly pending: PendingMigration; readonly backup: string };

/**
 * Writes the team config's pending migration under the config lock, keeping the old file as a backup. It reads the
 * config again under the lock: a change written meanwhile is migrated with the rest, and a migration done meanwhile
 * is not written twice. `config migrate --yes` and the config-format step both write through it.
 */
export function writeConfigMigration(runtime: CliRuntime, kit: Kit, config: KitConfig): Promise<MigrationWrite> {
  return configLockOf(runtime, kit, config).run(async (writer): Promise<MigrationWrite> => {
    const now = await reloadTeamConfig(runtime, kit);
    if (now.status !== 'loaded' || now.pending === undefined) {
      return { status: 'unchanged' };
    }
    const backup = await writer.write(now.pending.migrated, migrationBackupName(now.pending));
    return { status: 'migrated', pending: now.pending, backup };
  });
}
