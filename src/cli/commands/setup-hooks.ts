import { join, posix, win32 } from 'node:path';
import { formatConfig, writeConfigWithBackup, writeTextWithBackup } from '../../config/load.ts';
import { errorMessage, type JsonRecord } from '../../core/guards.ts';
import type { ConfigLinesAnswer, HookLauncher, HostConfigFileSet, HostConfigLines, HostUserHooks, UserHooksAnswer } from '../../ports/host/index.ts';
import { hookLauncher, hookLauncherProblem } from '../../kit/hook-launcher.ts';
import { resolveKitHome } from '../../core/home.ts';
import { noPositionals, requiredFlag, type ParsedArgs } from '../args.ts';
import { readUserSettings } from '../user-settings.ts';
import { userHooksHostId, userHooksOf } from '../host.ts';
import { teamHostsOf } from '../team-hosts.ts';
import { pluginRootOf } from '../plugin-root.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `setup hooks --host <name> [--yes]`: puts teamrig's hooks into the person's own hooks file of a host that loads no
 * plugin's hooks (its adapter names the file), beside the person's own handlers, which stay. teamrig's earlier
 * handlers are replaced, so the same command rewrites lines an older release wrote. A host whose lines run the kit
 * launcher (`kitLauncher`, Codex) gets lines naming `<kit home>/bin/teamrig.mjs` and no version, so an update
 * leaves them as they are; the run is refused before any write until the kit home holds an intact current version and
 * its launcher, and while the team the run is for does not list in `hosts` the host the lines name (each hook run
 * naming an unlisted host is refused). Without --yes it only counts what would be inserted, unchanged, changed and removed; with it, the old
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
  const pluginRoot = pluginRootOf(runtime.self.script, pathOf(runtime), 'setup hooks');
  const write = args.switches.has('yes');
  const plan = await planHooksSetup(runtime, port, pluginRoot, args.flags.get('team') ?? args.common.get('team'));
  const { target, kit, unlisted, answer, configs } = plan;
  if (write && kit.problem !== undefined) {
    throw new RefusedError(`${kit.problem}; nothing written`);
  }
  if (write && unlisted !== undefined) {
    throw new RefusedError(`${unlisted}; nothing written`);
  }
  if (!answer.ok) {
    throw new RefusedError(`${answer.problem}; nothing written`);
  }
  // Every file is checked before any is written, so a refusal leaves the hooks and the config as they were.
  if (!configs.ok) {
    throw new RefusedError(`${configs.file}: ${configs.problem}; nothing written`);
  }
  const { file, counts, skipped } = answer.value;
  const counted = `inserted ${counts.inserted}, unchanged ${counts.unchanged}, changed ${counts.changed}, removed ${counts.removed}`;
  if (file === undefined) {
    runtime.out.stdout(`UNCHANGED ${target}: teamrig's hooks are already in it (${counted})`);
  } else if (!write) {
    runtime.out.stdout(`PREVIEW nothing written (add --yes to write) ${target}: ${counted}`);
  } else {
    const backup = await written(runtime, target, plan.existed, port.host, file);
    runtime.out.stdout(`WROTE ${target}: ${counted}${backup === undefined ? '' : `; the old file is at ${backup}`}`);
  }
  for (const config of configs.plans) {
    runtime.out.stdout(await configWritten(runtime, config, port.host, write));
  }
  [...skipped, ...configs.skipped].forEach((line) => runtime.out.stdout(`  SKIPPED ${line}`));
  if (kit.problem !== undefined) {
    runtime.out.stdout(`  NOTE --yes is refused until the kit home can run these lines: ${kit.problem}`);
  }
  if (unlisted !== undefined) {
    runtime.out.stdout(`  NOTE --yes is refused until the team lists the host: ${unlisted}`);
  }
  if (file !== undefined) {
    port.afterWrite.forEach((line) => runtime.out.stdout(`  NOTE ${line}`));
  }
  return EXIT.ok;
}

function pathOf(runtime: Pick<CliRuntime, 'platform'>): typeof posix {
  return runtime.platform === 'win32' ? win32 : posix;
}

/** The config files' plans, or the first file that cannot be edited and why. */
export type ConfigPlansAnswer = { readonly ok: true; readonly plans: readonly ConfigPlan[]; readonly skipped: readonly string[] } | ConfigRefusal;

/** A config file that cannot be edited as it is, and why. */
export interface ConfigRefusal {
  readonly ok: false;
  readonly file: string;
  readonly problem: string;
}

/**
 * What `setup hooks` would do for a host, read from the files as they are and writing nothing: the hooks file's merge,
 * each config file's setting, and what refuses a write. Its refusals are answers, not throws, so a caller that only
 * reads (a drift check) can say why, and `setup hooks` refuses in its own order.
 */
export interface HooksSetupPlan {
  readonly target: string;
  /** Whether the hooks file was there, so a write keeps the old one first. */
  readonly existed: boolean;
  readonly kit: KitLauncherState;
  readonly unlisted: string | undefined;
  readonly answer: UserHooksAnswer;
  readonly configs: ConfigPlansAnswer;
}

/**
 * Plans `setup hooks` for the host whose hooks file `port` names, with the plugin installed at `pluginRoot`, for the
 * team `team` names (the run's own team when undefined). Reads only. A missing or broken plugin hooks file refuses,
 * as nothing can be planned from it.
 */
export async function planHooksSetup(runtime: CliRuntime, port: HostUserHooks, pluginRoot: string, team: string | undefined): Promise<HooksSetupPlan> {
  const path = pathOf(runtime);
  const source = await pluginHooks(runtime, path.join(pluginRoot, ...PLUGIN_HOOKS));
  const target = port.file(runtime.userHome);
  const current = await readUserSettings(runtime, target);
  const kit = await launcherOf(runtime, port.kitLauncher !== undefined);
  const unlisted = await unlistedHost(runtime, userHooksHostId(runtime, port.host), team);
  const answer = port.merge(current.json, source, pluginRoot, kit.launcher);
  return { target, existed: current.exists, kit, unlisted, answer, configs: await allConfigPlans(runtime, port, path) };
}

async function allConfigPlans(runtime: CliRuntime, port: HostUserHooks, path: typeof posix): Promise<ConfigPlansAnswer> {
  const sets = await fileSetPlans(runtime, port.configFileSets ?? [], path);
  if (!sets.ok) {
    return sets;
  }
  const main = await configPlans(runtime, port.configLines);
  return main.ok ? { ok: true, plans: [...main.plans, ...sets.plans], skipped: sets.skipped } : main;
}

/**
 * Why the team this run is for cannot run the lines: each names `--host <id>`, and a hook run naming a host the team's
 * `hosts` does not list is refused (host-choice.ts), so every handler would exit 2 in its sessions. Undefined when no
 * team config loads (a first install) or the host is no shipped adapter, whose lines name no id.
 */
async function unlistedHost(runtime: CliRuntime, hostId: string | undefined, team: string | undefined): Promise<string | undefined> {
  if (hostId === undefined) {
    return undefined;
  }
  const listed = await teamHostsOf(runtime, team);
  if (listed === undefined || listed.includes(hostId)) {
    return undefined;
  }
  return `the team's hosts (${listed.join(', ')}) does not list ${hostId}, which these lines name, so each would be refused in its sessions: add ${hostId} to hosts in the team config first`;
}

/** The kit launcher a host's lines run, and why the kit home cannot run them yet. */
export interface KitLauncherState {
  readonly launcher?: HookLauncher;
  readonly problem?: string;
}

/**
 * The kit launcher a host's lines run, for a host whose lines run it; none for one whose lines name the plugin folder.
 * Its problem refuses a write while the kit home cannot run a line, as the launcher would block every guard event; a
 * preview still shows the lines, so an install that fills the kit home next (the install script previews first) can
 * show its whole plan.
 */
async function launcherOf(runtime: CliRuntime, runsLauncher: boolean): Promise<KitLauncherState> {
  if (!runsLauncher) {
    return {};
  }
  const kitHome = resolveKitHome(runtime.env, runtime.userHome);
  const problem = await hookLauncherProblem(runtime.files, kitHome);
  const launcher = hookLauncher(kitHome);
  return problem === undefined ? { launcher } : { launcher, problem };
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
export interface ConfigPlan {
  readonly file: string;
  readonly setting: string;
  readonly existed: boolean;
  readonly text: string | undefined;
  /** What the backup's name says after the host's: `config` for the host's main config, a set's file by its name. */
  readonly backupLabel: string;
}

const MAIN_CONFIG_LABEL = 'config';

async function configPlans(runtime: CliRuntime, lines: readonly HostConfigLines[]): Promise<ConfigPlansAnswer> {
  const plans: ConfigPlan[] = [];
  for (const config of lines) {
    const file = config.file(runtime.userHome);
    const current = await runtime.files.read(file);
    const plan = configPlan(file, config.setting, current, config.merge(current ?? ''), MAIN_CONFIG_LABEL);
    if (!plan.ok) {
      return plan;
    }
    plans.push(plan.plan);
  }
  return { ok: true, plans, skipped: [] };
}

type ConfigPlanAnswer = { readonly ok: true; readonly plan: ConfigPlan } | ConfigRefusal;

function configPlan(file: string, setting: string, current: string | undefined, answer: ConfigLinesAnswer, backupLabel: string): ConfigPlanAnswer {
  if (!answer.ok) {
    return { ok: false, file, problem: answer.problem };
  }
  return { ok: true, plan: { file, setting, existed: current !== undefined, text: answer.text, backupLabel } };
}

/**
 * Each set's files as they are in its folder, by name: plans for the plain ones; the matching entries that are no plain
 * file (a link, a folder) are skipped, as an atomic write would replace a link, so none is written.
 */
async function fileSetPlans(runtime: CliRuntime, sets: readonly HostConfigFileSet[], path: typeof posix): Promise<ConfigPlansAnswer> {
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
      if (current === undefined) {
        continue;
      }
      const plan = configPlan(file, set.setting, current, set.merge(current), name);
      if (!plan.ok) {
        return plan;
      }
      plans.push(plan.plan);
    }
  }
  return { ok: true, plans, skipped };
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
