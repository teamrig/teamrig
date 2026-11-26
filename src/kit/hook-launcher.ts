import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { checkClient } from '../exec/client-integrity.ts';
import type { HookLauncher } from '../ports/host/index.ts';
import { cliLauncherPath, KIT_LAUNCHER_FILE } from '../restore/cli-launcher.ts';
import { readKitCurrent, kitVersionFolder } from './kit-versions.ts';
import { ENTRY_FLAG, EVENT_FLAG, LAUNCHER_ENTRIES } from './launcher.ts';

/**
 * The kit launcher as a host's hook line names it (T5278 design D, section 6): `<kit home>/bin/teamrig.mjs`, the
 * words it reads, and its word for each entry script, so an adapter writes a line the launcher reads with no copy of
 * its rules.
 */
export function hookLauncher(kitHome: string): HookLauncher {
  return {
    path: cliLauncherPath(kitHome),
    entryFlag: ENTRY_FLAG,
    eventFlag: EVENT_FLAG,
    entries: new Map([...LAUNCHER_ENTRIES].map(([word, script]) => [script, word])),
  };
}

/**
 * Why the kit home cannot run a hook line yet, or undefined when it can: no version is current, the current one's
 * files differ from its integrity list, or the launcher is missing or not the one that version ships. The launcher
 * blocks every guard event of a kit it cannot run, so a host whose lines name it before then would refuse every tool
 * call.
 */
export async function hookLauncherProblem(files: Pick<Files, 'read'>, kitHome: string): Promise<string | undefined> {
  const current = await readKitCurrent(files, kitHome);
  const start = 'start one teamrig session, whose start copies teamrig there, or run teamrig kit use <version>';
  if (current === undefined) {
    return `no teamrig version is current in the kit home ${kitHome}: ${start}`;
  }
  const folder = kitVersionFolder(kitHome, current.version);
  const check = await checkClient(folder, files);
  if (check.kind !== 'intact') {
    return `teamrig ${current.version} in the kit home differs from its integrity list: ${start}`;
  }
  const path = cliLauncherPath(kitHome);
  const shipped = await files.read(join(folder, KIT_LAUNCHER_FILE));
  const written = await files.read(path);
  if (written === undefined || written !== shipped) {
    return `the kit launcher ${path} is ${written === undefined ? 'missing' : `not the one teamrig ${current.version} ships`}: ${start}`;
  }
  return undefined;
}
