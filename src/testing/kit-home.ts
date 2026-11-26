import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { VERSION_FIELD } from '../core/jsonl.ts';
import { CLIENT_MANIFEST, clientFileHash, clientManifestText } from '../exec/client-integrity.ts';
import { KIT_CURRENT_FORMAT, kitCurrentPath, kitCurrentRecordPath, kitVersionFolder } from '../kit/kit-versions.ts';
import { cliLauncherPath, KIT_LAUNCHER_FILE } from '../restore/cli-launcher.ts';

/** The kit launcher's text in a seeded version: any text works, as only its equality with the copy on PATH is read. */
export const SEEDED_LAUNCHER_TEXT = '// teamrig kit launcher\n';

/**
 * Writes a kit home whose `version` is current and intact, as a session start leaves it: the version's launcher and
 * its integrity list, both records naming it, and the launcher copied to `<kit home>/bin/teamrig.mjs`.
 */
export async function seedKitHome(files: Pick<Files, 'write'>, kitHome: string, version: string): Promise<void> {
  const folder = kitVersionFolder(kitHome, version);
  const list = clientManifestText(new Map([[KIT_LAUNCHER_FILE, clientFileHash(SEEDED_LAUNCHER_TEXT)]]));
  await files.write(join(folder, KIT_LAUNCHER_FILE), SEEDED_LAUNCHER_TEXT);
  await files.write(join(folder, CLIENT_MANIFEST), list);
  const record = { [VERSION_FIELD]: KIT_CURRENT_FORMAT, version, listHash: clientFileHash(list), source: { kind: 'claude-code-plugin' }, pinned: false };
  await files.write(kitCurrentRecordPath(kitHome), `${JSON.stringify(record, null, 2)}\n`);
  await files.write(kitCurrentPath(kitHome), `${version}\n`);
  await files.write(cliLauncherPath(kitHome), SEEDED_LAUNCHER_TEXT);
}
