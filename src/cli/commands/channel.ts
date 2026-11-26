import { join } from 'node:path';
import { KIT_NAME } from '../../core/home.ts';
import { findProgram } from '../../open/host-program.ts';
import { isUnsupported, type ChannelPlan, type HostPlugin, type PluginInstall } from '../../ports/host/index.ts';
import { runSteps } from '../../update/runner.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { hostOf, launcherIfTold, pathsOf } from '../host.ts';
import { checked, readUserSettings, settingsTargetOf, writeUserSettings } from '../user-settings.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `channel`, `channel stable` and `channel preview`: which release line this machine's teamrig install follows, and
 * moving it to the other. Stable follows the marketplace's default branch, whose catalog installs the stable
 * releases; preview follows the `preview` branch, whose catalog installs every release as it is cut. The move edits
 * the person's own user settings (the host refuses a branch they do not name) and runs the host's own plugin
 * commands; without --yes it only shows them. Only a marketplace the host keeps as a git clone follows a branch.
 */

/** The channels by the ref their marketplace follows: undefined is its default branch. */
const CHANNELS = { stable: undefined, preview: 'preview' } as const satisfies Record<string, string | undefined>;

export type Channel = keyof typeof CHANNELS;

function channelOf(ref: string | undefined): string {
  const named = Object.entries(CHANNELS).find(([, each]) => each === ref);
  return named === undefined ? `the branch ${ref ?? ''}, no channel teamrig names` : `the ${named[0]} channel`;
}

/** The host's plugin store, or its own reason it keeps none. */
function storeOf(runtime: CliRuntime): HostPlugin {
  const store = hostOf(runtime).plugin;
  if (isUnsupported(store)) {
    throw new RefusedError(store.notice);
  }
  return store;
}

interface Installed {
  readonly store: HostPlugin;
  readonly install: PluginInstall;
  readonly marketplacesText: string;
}

/** teamrig's install serving every project, else the first; refused when the host's plugin list holds none. */
async function installedOf(runtime: CliRuntime): Promise<Installed> {
  const store = storeOf(runtime);
  const folder = pathsOf(runtime).pluginsFolder(runtime.userHome);
  if (folder === undefined) {
    throw new RefusedError(`${KIT_NAME} does not know where this host keeps its installed plugins, so not which channel it follows`);
  }
  const listPath = join(folder, store.listFile);
  const installs = (store.installs((await runtime.files.read(listPath)) ?? '') ?? []).filter((each) => each.plugin === KIT_NAME);
  const install = installs.find((each) => each.reach.kind === 'every project') ?? installs[0];
  if (install === undefined) {
    throw new RefusedError(`${listPath} names no ${KIT_NAME} install from a marketplace, so it follows no channel`);
  }
  return { store, install, marketplacesText: (await runtime.files.read(join(folder, store.marketplacesFile))) ?? '' };
}

/** `channel`: the channel the install follows. */
export async function show(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const { store, install, marketplacesText } = await installedOf(runtime);
  const read = store.marketplaceRef(marketplacesText, install.marketplace);
  if (read === undefined) {
    throw new RefusedError(`the marketplace ${install.marketplace} is not a git clone, so ${KIT_NAME} follows no channel`);
  }
  runtime.out.stdout(`${KIT_NAME} ${install.version} follows ${channelOf(read.ref)} (marketplace ${install.marketplace})`);
  return EXIT.ok;
}

/** `channel stable [--yes]`. */
export async function stable(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  return move(args, runtime, 'stable');
}

/** `channel preview [--yes]`. */
export async function preview(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  return move(args, runtime, 'preview');
}

async function move(args: ParsedArgs, runtime: CliRuntime, channel: Channel): Promise<ExitCode> {
  noPositionals(args);
  const { store, install, marketplacesText } = await installedOf(runtime);
  const target = settingsTargetOf(runtime);
  const settings = await readUserSettings(runtime, target.settingsPath);
  const plan = checked(store.channelPlan(settings.json, marketplacesText, install.plugin, install.marketplace, CHANNELS[channel]));
  if (plan.settings === undefined && plan.steps.length === 0) {
    runtime.out.stdout(`UNCHANGED ${KIT_NAME} already follows the ${channel} channel`);
    return EXIT.ok;
  }
  // The host's program runs the steps: a host telling nothing of its sessions names none.
  const launcher = launcherIfTold(runtime);
  if (launcher === undefined) {
    throw new RefusedError('the host names no program to move a plugin with');
  }
  const lines = linesOf(plan, target.settingsPath, install.marketplace, launcher.program);
  if (!args.switches.has('yes')) {
    runtime.out.stdout(`PREVIEW nothing written (add --yes to write): ${channelOf(plan.before)} -> the ${channel} channel`);
    lines.forEach((line) => runtime.out.stdout(line));
    return EXIT.ok;
  }
  const found = await findProgram({ env: runtime.env, platform: runtime.platform, probe: runtime.probe, files: runtime.files, node: runtime.self.node }, launcher.program);
  if (found.kind === 'missing') {
    throw new RefusedError(`${launcher.program} is not on PATH; nothing written`);
  }
  const backup = plan.settings === undefined ? undefined : await writeUserSettings(runtime, target, settings, plan.settings);
  const outcome = await runSteps({ hooks: runtime.hooks, env: runtime.env, claude: found.program, cwd: runtime.userHome }, plan.steps);
  const kept = backup === undefined ? '' : `; the old settings file is at ${backup}`;
  if (!outcome.ok) {
    runtime.out.stderr(`FAILED ${outcome.step}${outcome.said === '' ? '' : `: ${outcome.said.slice(0, 300)}`}${kept}`);
    return EXIT.failed;
  }
  runtime.out.stdout(`DONE ${KIT_NAME} follows the ${channel} channel; a new session runs it${kept}`);
  lines.forEach((line) => runtime.out.stdout(line));
  return EXIT.ok;
}

function linesOf(plan: ChannelPlan, settingsPath: string, marketplace: string, program: string): string[] {
  const change = plan.settings === undefined ? [] : [`  CHANGE ${settingsPath}: the marketplace ${marketplace}'s own entry follows ${plan.after ?? 'its default branch'}`];
  return [...change, ...plan.steps.map((step) => `  RUN ${[program, ...step].join(' ')}`)];
}
