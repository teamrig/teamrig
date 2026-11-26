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
  const start = 'start one teamrig session or run the teamrig install script again, either of which copies teamrig there, or run teamrig kit use <version>';
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

/** What `syncKitLauncher` did to `<kit home>/bin/teamrig.mjs`. */
export type KitLauncherSync =
  | { readonly kind: 'written' | 'unchanged'; readonly path: string; readonly version: string }
  | { readonly kind: 'missing'; readonly why: string };

/**
 * Makes `<kit home>/bin/teamrig.mjs` the launcher the current version ships, the copy `hookLauncherProblem` holds a
 * hook line to. A session start writes it only when it puts teamrig on PATH, so an install that runs no session start
 * (a host with no teamrig plugin) writes it here. Names what is missing when no version is current or it ships none.
 */
export async function syncKitLauncher(files: Pick<Files, 'read' | 'write'>, kitHome: string): Promise<KitLauncherSync> {
  const current = await readKitCurrent(files, kitHome);
  if (current === undefined) {
    return { kind: 'missing', why: `no teamrig version is current in the kit home ${kitHome}` };
  }
  const shipped = await files.read(join(kitVersionFolder(kitHome, current.version), KIT_LAUNCHER_FILE));
  if (shipped === undefined) {
    return { kind: 'missing', why: `teamrig ${current.version} in the kit home ships no ${KIT_LAUNCHER_FILE}` };
  }
  const path = cliLauncherPath(kitHome);
  if ((await files.read(path)) === shipped) {
    return { kind: 'unchanged', path, version: current.version };
  }
  await files.write(path, shipped);
  return { kind: 'written', path, version: current.version };
}
