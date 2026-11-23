import { join, posix, win32 } from 'node:path';
import { formatConfig, writeConfigWithBackup, writeTextWithBackup } from '../../config/load.ts';
import { errorMessage, type JsonRecord } from '../../core/guards.ts';
import type { HostConfigLines } from '../../ports/host/index.ts';
import { resolveKitHome } from '../../core/home.ts';
import { noPositionals, requiredFlag, type ParsedArgs } from '../args.ts';
import { readUserSettings } from '../user-settings.ts';
import { userHooksOf } from '../host.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `setup hooks --host <name> [--yes]`: puts teamrig's hooks into the person's own hooks file of a host that loads no
 * plugin's hooks (its adapter names the file), beside the person's own handlers, which stay. teamrig's earlier
 * handlers are replaced, so the same command after an update rewrites them. Without --yes it only counts what would be
 * inserted, unchanged, changed and removed; with it, the old file is kept in the kit's backups folder first. It never
 * writes the host's trust in a handler: the person gives that in the host, after every write. A setting the hooks need
 * in the host's own config file (the adapter's `configLines`, such as a host's interactive shells off) is set the
 * same way, every other line kept, the old file backed up; any file it cannot edit refuses the run before a write.
 */

/** The plugin's entry script, below its root: `<root>/dist/cli/main.js`. */
const ENTRY_FOLDERS: readonly string[] = ['dist', 'cli'];
const ENTRY_SCRIPT = 'main.js';
/** The plugin's own hooks file, below its root. */
const PLUGIN_HOOKS: readonly string[] = ['hooks', 'hooks.json'];
/** A host config file's backup keeps its original's text whatever its format, so it takes no format's extension. */
const CONFIG_BACKUP_EXTENSION = '.bak';

/** `setup hooks --host <name> [--yes]`. */
export async function hooks(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const port = userHooksOf(runtime, requiredFlag(args.flags, 'host'));
  const path = runtime.platform === 'win32' ? win32 : posix;
  const pluginRoot = pluginRootOf(runtime.self.script, path);
  const source = await pluginHooks(runtime, path.join(pluginRoot, ...PLUGIN_HOOKS));
  const target = port.file(runtime.userHome);
  const current = await readUserSettings(runtime, target);
  const answer = port.merge(current.json, source, pluginRoot);
  if (!answer.ok) {
    throw new RefusedError(`${answer.problem}; nothing written`);
  }
  // Every file is checked before any is written, so a refusal leaves the hooks and the config as they were.
  const configs = await configPlans(runtime, port.configLines);
  const { file, counts, skipped } = answer.value;
  const counted = `inserted ${counts.inserted}, unchanged ${counts.unchanged}, changed ${counts.changed}, removed ${counts.removed}`;
  const write = args.switches.has('yes');
  if (file === undefined) {
    runtime.out.stdout(`UNCHANGED ${target}: teamrig's hooks are already in it (${counted})`);
  } else if (!write) {
    runtime.out.stdout(`PREVIEW nothing written (add --yes to write) ${target}: ${counted}`);
  } else {
    const backup = await written(runtime, target, current.exists, port.host, file);
    runtime.out.stdout(`WROTE ${target}: ${counted}${backup === undefined ? '' : `; the old file is at ${backup}`}`);
  }
  for (const config of configs) {
    runtime.out.stdout(await configWritten(runtime, config, port.host, write));
  }
  skipped.forEach((line) => runtime.out.stdout(`  SKIPPED ${line}`));
  if (file !== undefined) {
    port.afterWrite.forEach((line) => runtime.out.stdout(`  NOTE ${line}`));
  }
  return EXIT.ok;
}

/**
 * The installed plugin's root, from this CLI's entry script. A run from the source tree, or any script but the
 * plugin's built entry, has no installed hooks to point the host at, so it is refused.
 */
function pluginRootOf(script: string, path: typeof posix): string {
  const cli = path.dirname(script);
  const dist = path.dirname(cli);
  if (path.basename(script) !== ENTRY_SCRIPT || [path.basename(dist), path.basename(cli)].join('/') !== ENTRY_FOLDERS.join('/')) {
    throw new RefusedError(`setup hooks runs from the installed plugin's dist/cli/main.js, not ${script}, so the host runs the installed teamrig; nothing written`);
  }
  return path.dirname(dist);
}

async function pluginHooks(runtime: CliRuntime, file: string): Promise<unknown> {
  const text = await runtime.files.read(file);
  if (text === undefined) {
    throw new RefusedError(`the plugin's hooks file ${file} is missing; nothing written`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    throw new RefusedError(`the plugin's hooks file ${file} is not valid JSON (${errorMessage(error)}); nothing written`);
  }
}

/** A host config file's setting as `setup hooks` found it: the new text, or undefined when the file already holds it. */
interface ConfigPlan {
  readonly file: string;
  readonly setting: string;
  readonly existed: boolean;
  readonly text: string | undefined;
}

async function configPlans(runtime: CliRuntime, lines: readonly HostConfigLines[]): Promise<readonly ConfigPlan[]> {
  const plans: ConfigPlan[] = [];
  for (const config of lines) {
    const file = config.file(runtime.userHome);
    const current = await runtime.files.read(file);
    const answer = config.merge(current ?? '');
    if (!answer.ok) {
      throw new RefusedError(`${file}: ${answer.problem}; nothing written`);
    }
    plans.push({ file, setting: config.setting, existed: current !== undefined, text: answer.text });
  }
  return plans;
}

/** Writes one config file's setting with --yes (keeping the old file first), and says what it found or did. */
async function configWritten(runtime: CliRuntime, plan: ConfigPlan, host: string, write: boolean): Promise<string> {
  if (plan.text === undefined) {
    return `UNCHANGED ${plan.file}: it already sets ${plan.setting}`;
  }
  if (!write) {
    return `PREVIEW nothing written (add --yes to write) ${plan.file}: sets ${plan.setting}`;
  }
  if (!plan.existed) {
    await runtime.files.write(plan.file, plan.text);
    return `WROTE ${plan.file}: sets ${plan.setting}`;
  }
  const backupsDir = join(resolveKitHome(runtime.env, runtime.userHome), 'backups');
  const backup = await writeTextWithBackup(runtime.files, { configPath: plan.file, backupsDir, backupName: `${host}-config` }, plan.text, runtime.clock, CONFIG_BACKUP_EXTENSION);
  return `WROTE ${plan.file}: sets ${plan.setting}; the old file is at ${backup}`;
}

/** Writes the merged file, keeping the old one first when there was one; returns where it was kept. */
async function written(runtime: CliRuntime, target: string, existed: boolean, host: string, file: JsonRecord): Promise<string | undefined> {
  if (!existed) {
    await runtime.files.write(target, formatConfig(file));
    return undefined;
  }
  const backupsDir = join(resolveKitHome(runtime.env, runtime.userHome), 'backups');
  return writeConfigWithBackup(runtime.files, { configPath: target, backupsDir, backupName: `${host}-hooks` }, file, runtime.clock);
}
