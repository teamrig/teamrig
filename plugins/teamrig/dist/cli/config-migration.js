import { migrationBackupName } from "../config/load.js";
import { configLockOf, reloadTeamConfig } from "./kit.js";
/**
 * Writes the team config's pending migration under the config lock, keeping the old file as a backup. It reads the
 * config again under the lock: a change written meanwhile is migrated with the rest, and a migration done meanwhile
 * is not written twice. `config migrate --yes` and the config-format step both write through it.
 */
export function writeConfigMigration(runtime, kit, config) {
    return configLockOf(runtime, kit, config).run(async (writer) => {
        const now = await reloadTeamConfig(runtime, kit);
        if (now.status !== 'loaded' || now.pending === undefined) {
            return { status: 'unchanged' };
        }
        const backup = await writer.write(now.pending.migrated, migrationBackupName(now.pending));
        return { status: 'migrated', pending: now.pending, backup };
    });
}
