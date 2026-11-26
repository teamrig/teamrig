import { join, posix, win32 } from 'node:path';
import { formatConfig, writeConfigWithBackup, writeTextWithBackup } from '../../config/load.ts';
import { errorMessage, type JsonRecord } from '../../core/guards.ts';
import type { ConfigLinesAnswer, HookLauncher, HostConfigFileSet, HostConfigLines } from '../../ports/host/index.ts';
import { hookLauncher, hookLauncherProblem } from '../../kit/hook-launcher.ts';
import { resolveKitHome } from '../../core/home.ts';
import { noPositionals, requiredFlag, type ParsedArgs } from '../args.ts';
import { readUserSettings } from '../user-settings.ts';
import { userHooksOf } from '../host.ts';
import { pluginRootOf } from '../plugin-root.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `setup hooks --host <name> [--yes]`: puts teamrig's hooks into the person's own hooks file of a host that loads no
 * plugin's hooks (its adapter names the file), beside the person's own handlers, which stay. teamrig's earlier
 * handlers are replaced, so the same command rewrites lines an older release wrote. A host whose lines run the kit
 * launcher (`runsKitLauncher`, Codex) gets lines naming `<kit home>/bin/teamrig.mjs` and no version, so an update
 * leaves them as they are; the run is refused before any write until the kit home holds an intact current version and
 * its launcher. Without --yes it only counts what would be inserted, unchanged, changed and removed; with it, the old
 * file is kept in the kit's backups folder first. It never writes the host's trust in a handler: the person gives that
 * in the host, after every write. A setting the hooks need
 * in the host's own config file (the adapter's `configLines`, such as a host's interactive shells off) is set the
 * same way, every other line kept, the old file backed up; any file it cannot edit refuses the run before a write.
 * A set of config files the host layers over its main one (the adapter's `configFileSets`, such as Codex's
 * `<name>.config.toml` profiles) is edited file by file the same way; none is created.
 */

/** The plugin's own hooks file, below its root. */
const PLUGIN_HOOKS: readonly string[] = ['hooks', 'hooks.json'];
/** A host config file's backup keeps its original's text whatever its format, so it takes no format's extension. */
const CONFIG_BACKUP_EXTENSION = '.bak';

/** `setup hooks --host <name> [--yes]`. */
export async function hooks(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const port = userHooksOf(runtime, requiredFlag(args.flags, 'host'));
  const path = runtime.platform === 'win32' ? win32 : posix;
  const pluginRoot = pluginRootOf(runtime.self.script, path, 'setup hooks');
  const source = await pluginHooks(runtime, path.join(pluginRoot, ...PLUGIN_HOOKS));
  const target = port.file(runtime.userHome);
  const current = await readUserSettings(runtime, target);
  const answer = port.merge(current.json, source, pluginRoot, await launcherOf(runtime, port.runsKitLauncher === true));
  if (!answer.ok) {
    throw new RefusedError(`${answer.problem}; nothing written`);
  }
  // Every file is checked before any is written, so a refusal leaves the hooks and the config as they were.
  const sets = await fileSetPlans(runtime, port.configFileSets ?? [], path);
  const configs = [...(await configPlans(runtime, port.configLines)), ...sets.plans];
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
  [...skipped, ...sets.skipped].forEach((line) => runtime.out.stdout(`  SKIPPED ${line}`));
  if (file !== undefined) {
    port.afterWrite.forEach((line) => runtime.out.stdout(`  NOTE ${line}`));
  }
  return EXIT.ok;
}

/**
 * The kit launcher a host's lines run, for a host whose lines run it; undefined for one whose lines name the plugin
 * folder. Refused before any write while the kit home cannot run a line: the launcher would block every guard event.
 */
async function launcherOf(runtime: CliRuntime, runsKitLauncher: boolean): Promise<HookLauncher | undefined> {
  if (!runsKitLauncher) {
    return undefined;
  }
  const kitHome = resolveKitHome(runtime.env, runtime.userHome);
  const problem = await hookLauncherProblem(runtime.files, kitHome);
  if (problem !== undefined) {
    throw new RefusedError(`${problem}; nothing written`);
  }
  return hookLauncher(kitHome);
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
  /** What the backup's name says after the host's: `config` for the host's main config, a set's file by its name. */
  readonly backupLabel: string;
}

const MAIN_CONFIG_LABEL = 'config';

async function configPlans(runtime: CliRuntime, lines: readonly HostConfigLines[]): Promise<readonly ConfigPlan[]> {
  const plans: ConfigPlan[] = [];
  for (const config of lines) {
    const file = config.file(runtime.userHome);
    const current = await runtime.files.read(file);
    plans.push(configPlan(file, config.setting, current, config.merge(current ?? ''), MAIN_CONFIG_LABEL));
  }
  return plans;
}

function configPlan(file: string, setting: string, current: string | undefined, answer: ConfigLinesAnswer, backupLabel: string): ConfigPlan {
  if (!answer.ok) {
    throw new RefusedError(`${file}: ${answer.problem}; nothing written`);
  }
  return { file, setting, existed: current !== undefined, text: answer.text, backupLabel };
}

/** Each set's files as they are in its folder, by name: plans for the plain ones, the rest left as they are. */
interface FileSetPlans {
  readonly plans: readonly ConfigPlan[];
  /** The matching entries that are no plain file (a link, a folder): an atomic write would replace a link, so none is written. */
  readonly skipped: readonly string[];
}

async function fileSetPlans(runtime: CliRuntime, sets: readonly HostConfigFileSet[], path: typeof posix): Promise<FileSetPlans> {
  const plans: ConfigPlan[] = [];
  const skipped: string[] = [];
  for (const set of sets) {
    const folder = set.folder(runtime.userHome);
    for (const name of (await runtime.files.list(folder)).filter((entry) => set.holds(entry)).toSorted()) {
      const file = path.join(folder, name);
      if (!(await runtime.files.isPlainFile(file))) {
        skipped.push(`${file}: not a plain file, so teamrig leaves it as it is; set ${set.setting} in it by hand`);
        continue;
      }
      const current = await runtime.files.read(file);
      if (current !== undefined) plans.push(configPlan(file, set.setting, current, set.merge(current), name));
    }
  }
  return { plans, skipped };
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
  const backup = await writeTextWithBackup(runtime.files, { configPath: plan.file, backupsDir, backupName: `${host}-${plan.backupLabel}` }, plan.text, runtime.clock, CONFIG_BACKUP_EXTENSION);
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
