import { posix, win32 } from 'node:path';
import type { Files } from '../../core/files.ts';
import { resolveKitHome } from '../../core/home.ts';
import { noPositionals, requiredFlag, type ParsedArgs } from '../args.ts';
import { pluginSkillsOf } from '../host.ts';
import { pluginRootOf } from '../plugin-root.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `setup skills --host <name> [--yes]`: copies teamrig's skills into the person's own skills folder of a host that
 * loads no plugin's skills (its adapter names the folder), so the host's model reads the guide, the team setup and
 * every other skill as a plugin-loading host's does. The folder is teamrig's alone: the copy makes it hold exactly the
 * installed plugin's skills, so the same command after an update rewrites them and drops the ones the plugin no
 * longer ships. Without --yes it only counts the files it would insert, keep, change and remove; with it, a folder
 * that held files is first moved whole into the kit's backups folder.
 */

/** The plugin's skills, below its root: `<root>/skills/<skill>/SKILL.md` and the files beside each. */
const PLUGIN_SKILLS = 'skills';

/** How many skill files a copy adds, keeps as they were, rewrites and takes out. */
interface SkillFileCounts {
  readonly inserted: number;
  readonly unchanged: number;
  readonly changed: number;
  readonly removed: number;
}

/** `setup skills --host <name> [--yes]`. */
export async function skills(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const port = pluginSkillsOf(runtime, requiredFlag(args.flags, 'host'));
  const path = runtime.platform === 'win32' ? win32 : posix;
  const source = path.join(pluginRootOf(runtime.self.script, path, 'setup skills'), PLUGIN_SKILLS);
  const shipped = await filesBelow(runtime.files, source, path);
  if (shipped.size === 0) {
    throw new RefusedError(`the plugin's skills folder ${source} holds no file; nothing written`);
  }
  const target = port.folder(runtime.userHome);
  const current = await filesBelow(runtime.files, target, path);
  const counts = countsOf(current, shipped);
  const counted = `inserted ${counts.inserted}, unchanged ${counts.unchanged}, changed ${counts.changed}, removed ${counts.removed}`;
  if (counts.inserted + counts.changed + counts.removed === 0) {
    runtime.out.stdout(`UNCHANGED ${target}: teamrig's skills are already in it (${counted})`);
    return EXIT.ok;
  }
  if (!args.switches.has('yes')) {
    runtime.out.stdout(`PREVIEW nothing written (add --yes to write) ${target}: ${counted}`);
    return EXIT.ok;
  }
  const backup = current.size === 0 ? undefined : await movedAside(runtime, target, port.host, path);
  for (const [relative, text] of shipped) {
    await runtime.files.write(path.join(target, ...relative.split('/')), text);
  }
  runtime.out.stdout(`WROTE ${target}: ${counted}${backup === undefined ? '' : `; the old folder is at ${backup}`}`);
  port.afterWrite.forEach((line) => runtime.out.stdout(`  NOTE ${line}`));
  return EXIT.ok;
}

/**
 * Every regular file below `folder`, by its path below it in `/` spelling, with its text; empty when the folder is
 * missing. An entry that is neither a file nor a folder holding files (a link, an empty folder) is left out.
 */
async function filesBelow(files: Files, folder: string, path: typeof posix): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  const walk = async (at: string, below: readonly string[]): Promise<void> => {
    for (const name of await files.list(at)) {
      const entry = path.join(at, name);
      if (await files.isPlainFile(entry)) {
        const text = await files.read(entry);
        if (text !== undefined) found.set([...below, name].join('/'), text);
      } else {
        await walk(entry, [...below, name]);
      }
    }
  };
  await walk(folder, []);
  return found;
}

function countsOf(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): SkillFileCounts {
  let inserted = 0;
  let unchanged = 0;
  let changed = 0;
  for (const [relative, text] of after) {
    const old = before.get(relative);
    if (old === undefined) inserted += 1;
    else if (old === text) unchanged += 1;
    else changed += 1;
  }
  const removed = [...before.keys()].filter((relative) => !after.has(relative)).length;
  return { inserted, unchanged, changed, removed };
}

/** Moves the folder whole into the kit's backups folder, under a name the run's time makes its own; returns where. */
async function movedAside(runtime: CliRuntime, folder: string, host: string, path: typeof posix): Promise<string> {
  const stamp = new Date(runtime.clock.now()).toISOString().replace(/[-:.]/gu, '');
  const backup = path.join(resolveKitHome(runtime.env, runtime.userHome), 'backups', `${host}-skills-${stamp}`);
  await runtime.files.move(folder, backup);
  return backup;
}
