import { join } from 'node:path';
import { writeConfigWithBackup } from '../../config/load.ts';
import type { JsonRecord } from '../../core/guards.ts';
import { resolveKitHome } from '../../core/home.ts';
import { WRITE_SWITCH } from '../../core/settings-writers.ts';
import type { Mutex } from '../../core/lock.ts';
import { KIT_VERSION } from '../../core/version.ts';
import { clientRootOf } from '../../exec/client-integrity.ts';
import { compareVersions, parseVersion } from '../../core/release-version.ts';
import { hookLauncher, syncKitLauncher } from '../../kit/hook-launcher.ts';
import { channelReleaseOf, cloneRelease, isKitChannel, KIT_CHANNELS, listChannel, type KitChannel } from '../../kit/kit-release.ts';
import { findProgram } from '../../open/host-program.ts';
import { cliLauncherPath, KIT_LAUNCHER_FILE } from '../../restore/cli-launcher.ts';
import { cliOnPathSteps } from '../../restore/cli-on-path.ts';
import { installRunningKit, keptAsideNote, KIT_COMMAND_LOCK, kitInstallLockPath } from '../../kit/kit-self-install.ts';
import {
  damagedPreviewWhy,
  installKitVersion,
  KIT_LOCK_BUSY,
  kitInstallParts,
  kitLeftovers,
  listKitVersions,
  planKitUse,
  prunableKitVersions,
  pruneKitVersions,
  readKitCurrent,
  uninstallKit,
  useKitVersion,
  kitVersionFolder,
  type KitCurrent,
  type KitInstallOutcome,
  type KitSource,
  type KitUseTarget,
} from '../../kit/kit-versions.ts';
import { noPositionals, requiredFlag, UsageError, type ParsedArgs } from '../args.ts';
import { fileLockOf, type FileLockRuntime } from '../file-locks.ts';
import { kitLauncherHooksOf } from '../host.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { readUserSettings } from '../user-settings.ts';

/**
 * `teamrig kit ...`: teamrig's own install under the kit home (src/kit/kit-versions.ts), the copy of each release a
 * session start ran, one named current; hosts run it once their hooks point at the kit home. `kit versions` lists
 * what is kept, `kit use` moves which one is current, `kit prune` removes the ones past the rollback window,
 * `kit update` installs a channel's newest release by its tag, `kit uninstall` removes the install, its hook lines first.
 */

const LATEST = 'latest';

type KitRuntime = Pick<CliRuntime, 'kitTree' | 'env' | 'userHome' | 'out'> & FileLockRuntime;

function kitHomeOf(runtime: KitRuntime): string {
  return resolveKitHome(runtime.env, runtime.userHome);
}

/** The kit home's install lock as the person's command takes it: a short wait for a session start's copy. */
function commandLockOf(runtime: KitRuntime, kitHome: string): Mutex {
  return fileLockOf(runtime, kitInstallLockPath(kitHome), KIT_COMMAND_LOCK);
}

/** How a record names where its version came from. */
function sourceText({ source }: Pick<KitCurrent, 'source'>): string {
  return source.kind === 'github-release' ? `github-release ${source.tag} ${source.commit}` : source.kind;
}

/**
 * `teamrig kit versions`: the versions kept in the kit home, newest first, the one in use marked `current`, with
 * `pinned` when `teamrig kit use` pinned it, and those a prune would remove marked `past the rollback window`.
 */
export async function kitVersions(args: ParsedArgs, runtime: KitRuntime): Promise<ExitCode> {
  noPositionals(args);
  const kitHome = kitHomeOf(runtime);
  const kept = await listKitVersions(runtime.files, kitHome);
  if (kept.length === 0) {
    runtime.out.stdout(`no teamrig version is installed in ${kitHome}; a session start of the teamrig plugin installs one`);
    return EXIT.ok;
  }
  const current = await readKitCurrent(runtime.files, kitHome);
  const prunable = new Set(await prunableKitVersions(runtime.files, kitHome));
  for (const version of kept) {
    const marks =
      version === current?.version ? [current.pinned ? 'current, pinned' : 'current', sourceText(current)] : prunable.has(version) ? ['past the rollback window'] : [];
    runtime.out.stdout(marks.length === 0 ? version : `${version}  ${marks.join('  ')}`);
  }
  if (current === undefined) {
    runtime.out.stdout('NOTE no version is current: the records naming it are missing or disagree; teamrig kit use --latest names the newest');
  }
  return EXIT.ok;
}

/** The version `kit use` names: one positional, or `--latest`, never both. */
function useTargetOf(args: ParsedArgs): KitUseTarget {
  const latest = args.switches.has(LATEST);
  const [version, ...more] = args.positionals;
  if (more.length > 0 || (latest && version !== undefined) || (!latest && version === undefined)) {
    throw new UsageError('teamrig kit use takes one version, or --latest: teamrig kit use <version>|--latest [--yes]');
  }
  return version === undefined ? { kind: 'latest' } : { kind: 'version', version };
}

/**
 * `teamrig kit use <version>|--latest [--yes]`: moves `current` to a kept version whose files match its integrity list.
 * A named version is pinned, so a session start of a newer plugin leaves it in use; `--latest` moves to the newest kept
 * one and clears the pin. Without `--yes` it shows the move and writes nothing. Its write is a settings writer's
 * (src/core/settings-writers.ts): it names the code every host's guards run once their hooks point at the kit
 * home, so only the person runs it.
 */
export async function kitUse(args: ParsedArgs, runtime: KitRuntime): Promise<ExitCode> {
  const target = useTargetOf(args);
  const ports = { files: runtime.files, kitHome: kitHomeOf(runtime) };
  if (!args.switches.has(WRITE_SWITCH)) {
    const plan = await planKitUse(ports, target);
    if (plan.kind === 'refused') {
      throw new RefusedError(`teamrig kit use: ${plan.why}`);
    }
    if (plan.kind === 'damaged') {
      throw new RefusedError(`teamrig kit use: ${damagedPreviewWhy(plan)}`);
    }
    const from = plan.previous === undefined ? 'no version' : plan.previous.version;
    const pin = plan.next.pinned ? ', pinned' : ', no pin';
    runtime.out.stdout(`PREVIEW nothing written (add --${WRITE_SWITCH} to write): current ${from} -> ${plan.next.version}${pin}`);
    return EXIT.ok;
  }
  const outcome = await useKitVersion({ ...ports, lock: commandLockOf(runtime, ports.kitHome) }, target);
  if (outcome.kind === 'refused') {
    throw new RefusedError(`teamrig kit use: ${outcome.why}`);
  }
  const from = outcome.previous === undefined ? '' : ` (was ${outcome.previous})`;
  const pin = outcome.pinned ? `pinned: a session start of a newer plugin leaves it in use until teamrig kit use --${LATEST}` : 'no pin';
  runtime.out.stdout(`WROTE current ${outcome.version}${from}, ${pin}`);
  return EXIT.ok;
}

/** A count, then the names when there are any: `2: a, b`, or `0`. */
function countedList(names: readonly string[]): string {
  return names.length === 0 ? '0' : `${names.length}: ${names.join(', ')}`;
}

/**
 * `teamrig kit prune [--yes]`: removes the kept versions past the rollback window, never the one in use nor the newest
 * newer one, and what stopped installs left (`versions/<v>.partial`, `<v>.replaced`, temp files). Without `--yes` it
 * names them and removes nothing. A version a running process holds open stays for the next prune.
 */
export async function kitPrune(args: ParsedArgs, runtime: KitRuntime): Promise<ExitCode> {
  noPositionals(args);
  const kitHome = kitHomeOf(runtime);
  if (!args.switches.has(WRITE_SWITCH)) {
    const prunable = await prunableKitVersions(runtime.files, kitHome);
    runtime.out.stdout(`PREVIEW nothing removed (add --${WRITE_SWITCH} to remove): removed ${countedList(prunable)}`);
    const leftovers = (await kitLeftovers(runtime.files, kitHome)).map((leftover) => leftover.path);
    if (leftovers.length > 0) {
      runtime.out.stdout(`PREVIEW leftovers of stopped installs ${countedList(leftovers)}`);
    }
    return EXIT.ok;
  }
  const outcome = await pruneKitVersions({ files: runtime.files, tree: runtime.kitTree, kitHome, lock: commandLockOf(runtime, kitHome) });
  if (outcome.kind === 'busy') {
    throw new RefusedError(`teamrig kit prune: ${KIT_LOCK_BUSY}`);
  }
  runtime.out.stdout(`REMOVED ${countedList(outcome.removed)}`);
  if (outcome.leftovers.length > 0) {
    runtime.out.stdout(`REMOVED leftovers of stopped installs ${countedList(outcome.leftovers)}`);
  }
  if (outcome.failed.length > 0) {
    runtime.out.stdout(`NOTE left for the next prune, a running process holds a file: ${outcome.failed.join(', ')}`);
    return EXIT.failed;
  }
  return EXIT.ok;
}

/** A release's commit as git names it: 40 lowercase hex characters. */
const COMMIT = /^[0-9a-f]{40}$/u;

type KitInstallRuntime = KitRuntime & Pick<CliRuntime, 'self' | 'files' | 'platform' | 'restore'>;

/** What the PATH lines end with: a terminal open already keeps the PATH it started with. */
export const NEW_TERMINAL_NOTE = 'NOTE open a new terminal: one open already keeps the PATH it started with';

/**
 * Puts `teamrig` on the user's PATH as a plugin's session start does (src/restore/cli-on-path.ts): the kit home's bin
 * launchers, then that folder added to the user's PATH, every entry kept. The kit launcher is the one the kit home
 * holds, else (a preview of a first install) this client's, so the step never undoes the launcher of a pinned version.
 * Without `write` it names each step and takes none; failed when a step fails.
 */
async function cliPutOnPath(runtime: KitInstallRuntime, kitHome: string, write: boolean): Promise<ExitCode> {
  const { files, platform, restore } = runtime;
  const launcherText =
    (await files.read(cliLauncherPath(kitHome))) ?? (await files.read(join(clientRootOf(runtime.self.script), KIT_LAUNCHER_FILE)).catch(() => undefined));
  if (launcherText === undefined) {
    runtime.out.stdout(`NOTE teamrig is not put on your PATH: ${clientRootOf(runtime.self.script)} ships no ${KIT_LAUNCHER_FILE}`);
    return EXIT.failed;
  }
  const steps = await cliOnPathSteps({ files, kitHome, launcherText, platform, userPath: restore.userPath, markExecutable: restore.markExecutable });
  if (steps.length === 0) {
    runtime.out.stdout(`UNCHANGED teamrig is on your PATH already (${restore.userPath.where})`);
    return EXIT.ok;
  }
  if (!write) {
    steps.forEach((step) => runtime.out.stdout(`PREVIEW ${step.line}`));
    return EXIT.ok;
  }
  for (const step of steps) {
    try {
      await step.act();
    } catch (error) {
      runtime.out.stdout(`FAILED ${step.line}: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT.failed;
    }
    runtime.out.stdout(step.line);
  }
  runtime.out.stdout(NEW_TERMINAL_NOTE);
  return EXIT.ok;
}

/** The release `kit install` records: `--tag`, which must name this client's own version, and its 40-hex `--commit`. */
function releaseSourceOf(args: ParsedArgs): KitSource {
  const tag = requiredFlag(args.flags, 'tag');
  const commit = requiredFlag(args.flags, 'commit');
  if (tag !== `v${KIT_VERSION}`) {
    throw new UsageError(`teamrig kit install: --tag ${tag} is not this teamrig's release tag v${KIT_VERSION}`);
  }
  if (!COMMIT.test(commit)) {
    throw new UsageError(`teamrig kit install: --commit ${commit} is not a 40-character git commit`);
  }
  return { kind: 'github-release', tag, commit };
}

/**
 * `teamrig kit install --tag <tag> --commit <sha> [--yes]`: copies the running teamrig, a clone of the release branch,
 * into the kit home's `versions/` as the release `--tag` at `--commit` names, makes it current unless a pin or a newer
 * version holds `current`, and writes the kit launcher hook lines run (`<kit home>/bin/teamrig.mjs`). It is the install
 * a session start does for a host whose plugin runs teamrig, for a host with none; the teamrig install script runs it
 * before `teamrig setup hooks`. Last it puts `teamrig` on the user's PATH as that session start does (cliPutOnPath).
 * Without `--yes` it shows the install and writes nothing. Its write is a settings writer's
 * (src/core/settings-writers.ts): it moves the code every host's guards run, so only the person runs it.
 */
export async function kitInstall(args: ParsedArgs, runtime: KitInstallRuntime): Promise<ExitCode> {
  noPositionals(args);
  const source = releaseSourceOf(args);
  const kitHome = kitHomeOf(runtime);
  const clientRoot = clientRootOf(runtime.self.script);
  const release = `teamrig ${KIT_VERSION} (${sourceText({ source })})`;
  if (!args.switches.has(WRITE_SWITCH)) {
    const current = await readKitCurrent(runtime.files, kitHome);
    runtime.out.stdout(
      `PREVIEW nothing written (add --${WRITE_SWITCH} to write): copy ${release} from ${clientRoot} to ${kitVersionFolder(kitHome, KIT_VERSION)}; ` +
        `current ${current?.version ?? 'no version'} -> ${KIT_VERSION} unless a pin or a newer version holds it`,
    );
    return cliPutOnPath(runtime, kitHome, false);
  }
  const outcome = await installRunningKit({
    files: runtime.files,
    tree: runtime.kitTree,
    kitHome,
    clientRoot,
    version: KIT_VERSION,
    source,
    lock: commandLockOf(runtime, kitHome),
  });
  if (outcome.kind === 'skipped') {
    if (outcome.why === 'no-integrity-list') {
      throw new RefusedError(`teamrig kit install: ${clientRoot} holds no integrity list, so it is no built release; nothing written`);
    }
    runtime.out.stdout(`UNCHANGED ${release} runs from the kit home already`);
  }
  const written = outcome.kind === 'skipped' ? await launcherWritten(runtime, kitHome) : await installReported('kit install', outcome, release, runtime, kitHome);
  return written === EXIT.ok ? cliPutOnPath(runtime, kitHome, true) : written;
}

/**
 * Prints what an install of `release` did, then writes the kit launcher of the version current names: refused for a
 * held lock or a release the install would not take, failed when no launcher could be written.
 */
async function installReported(command: string, outcome: KitInstallOutcome, release: string, runtime: KitRuntime & Pick<CliRuntime, 'files'>, kitHome: string): Promise<ExitCode> {
  switch (outcome.kind) {
    case 'busy':
      throw new RefusedError(`teamrig ${command}: ${KIT_LOCK_BUSY}`);
    case 'refused':
      throw new RefusedError(`teamrig ${command}: ${outcome.why}`);
    case 'installed':
      runtime.out.stdout(`WROTE current ${outcome.version}${outcome.previous === undefined ? '' : ` (was ${outcome.previous})`}: ${release}`);
      break;
    case 'current':
      runtime.out.stdout(`UNCHANGED current ${outcome.version} is installed already`);
      break;
    case 'pinned':
    case 'older':
      runtime.out.stdout(`NOTE ${keptAsideNote(outcome)}`);
      break;
  }
  return launcherWritten(runtime, kitHome);
}

/** Writes the kit launcher of the version current names, saying whether it changed; failed when none could be written. */
async function launcherWritten(runtime: Pick<CliRuntime, 'files' | 'out'>, kitHome: string): Promise<ExitCode> {
  const launcher = await syncKitLauncher(runtime.files, kitHome);
  if (launcher.kind === 'missing') {
    runtime.out.stdout(`NOTE the kit launcher is not written: ${launcher.why}`);
    return EXIT.failed;
  }
  runtime.out.stdout(`${launcher.kind === 'written' ? 'WROTE' : 'UNCHANGED'} ${launcher.path}: the kit launcher of teamrig ${launcher.version}`);
  return EXIT.ok;
}

type KitUpdateRuntime = KitRuntime & Pick<CliRuntime, 'files' | 'platform' | 'probe' | 'self' | 'run' | 'pid'>;

/** The channel `kit update` follows: `--channel`, else stable. */
function updateChannelOf(args: ParsedArgs): KitChannel {
  const named = args.flags.get('channel') ?? 'stable';
  if (!isKitChannel(named)) {
    throw new UsageError(`teamrig kit update: --channel ${named} is no channel; name ${Object.keys(KIT_CHANNELS).join(' or ')}`);
  }
  return named;
}

/** The git program by its absolute path from PATH, never a bare name Windows would look for in the current folder first. */
async function gitOf(runtime: KitUpdateRuntime): Promise<string> {
  const found = await findProgram({ env: runtime.env, platform: runtime.platform, probe: runtime.probe, files: runtime.files, node: runtime.self.node }, 'git');
  if (found.kind === 'missing' || found.program.prefix.length > 0) {
    throw new RefusedError('teamrig kit update: no git program is on PATH; install git and run this again; nothing written');
  }
  return found.program.command;
}

/**
 * `teamrig kit update [--channel stable|preview] [--yes]`: the already-installed teamrig finds the newest release tag at
 * the head of the channel's branch, clones it by that tag into a folder of the kit home's `install/`, checks the clone's
 * HEAD is the tag's commit, and installs it as `kit install` does: current moves to it unless a pin holds it, and the
 * launcher is written. It refuses a release older than current (only `kit use` moves down) and touches no hooks file.
 * Without `--yes` it shows the release and writes nothing; its write is a settings writer's, as `kit install`'s is.
 */
export async function kitUpdate(args: ParsedArgs, runtime: KitUpdateRuntime): Promise<ExitCode> {
  noPositionals(args);
  const channel = updateChannelOf(args);
  const branch = KIT_CHANNELS[channel];
  const kitHome = kitHomeOf(runtime);
  const git = { git: await gitOf(runtime), run: runtime.run };
  const listed = await listChannel(git, branch);
  if (listed.kind === 'failed') {
    throw new RefusedError(`teamrig kit update: ${listed.why}; nothing written`);
  }
  const found = channelReleaseOf(listed.text, branch);
  if (found.kind === 'none') {
    throw new RefusedError(`teamrig kit update: the ${channel} channel: ${found.why}; nothing written`);
  }
  const { release } = found;
  const current = await readKitCurrent(runtime.files, kitHome);
  const order = current === undefined ? 1 : releaseOrder(release.version, current.version);
  if (current !== undefined && order < 0) {
    throw new RefusedError(
      `teamrig kit update: the ${channel} channel's ${release.tag} is older than current ${current.version}; an update never moves current down, teamrig kit use <version> does`,
    );
  }
  if (current !== undefined && order === 0) {
    runtime.out.stdout(`UNCHANGED current ${current.version} is the ${channel} channel's newest release ${release.tag}`);
    return EXIT.ok;
  }
  const source: KitSource = { kind: 'github-release', tag: release.tag, commit: release.commit };
  const text = `teamrig ${release.version} (${sourceText({ source })})`;
  if (!args.switches.has(WRITE_SWITCH)) {
    runtime.out.stdout(
      `PREVIEW nothing written (add --${WRITE_SWITCH} to write): clone ${text} of the ${channel} channel into ${kitVersionFolder(kitHome, release.version)}; ` +
        `current ${current?.version ?? 'no version'} -> ${release.version} unless a pin holds it`,
    );
    return EXIT.ok;
  }
  const folder = join(kitHome, 'install', `kit-update-${runtime.pid}`);
  await runtime.kitTree.removeFolder(folder);
  try {
    const clone = await cloneRelease(git, release, folder);
    if (clone.kind === 'failed') {
      throw new RefusedError(`teamrig kit update: ${clone.why}; nothing written`);
    }
    const outcome = await installKitVersion({
      files: runtime.files,
      tree: runtime.kitTree,
      kitHome,
      from: clone.pluginRoot,
      version: release.version,
      source,
      lock: commandLockOf(runtime, kitHome),
    });
    return await installReported('kit update', outcome, text, runtime, kitHome);
  } finally {
    await runtime.kitTree.removeFolder(folder);
  }
}

/** Where release `a` stands to `b`: negative before, zero the same, positive after; a version neither parses as is after. */
function releaseOrder(a: string, b: string): number {
  const wanted = parseVersion(a);
  const held = parseVersion(b);
  return wanted === undefined || held === undefined ? 1 : compareVersions(wanted, held);
}

/** One host's hooks file as `kit uninstall` found it: the file with teamrig's lines out, undefined when it holds none. */
interface HooksRemoval {
  readonly host: string;
  readonly target: string;
  readonly file: JsonRecord | undefined;
  readonly removed: number;
}

/** Each existing hooks file whose host's lines run the kit launcher, read and planned before anything is written. */
async function hooksRemovals(runtime: CliRuntime, kitHome: string): Promise<readonly HooksRemoval[]> {
  const launcher = hookLauncher(kitHome);
  const removals: HooksRemoval[] = [];
  for (const { port, lines } of kitLauncherHooksOf(runtime)) {
    const target = port.file(runtime.userHome);
    const current = await readUserSettings(runtime, target);
    if (!current.exists) continue;
    const answer = lines.remove(current.json, launcher);
    if (!answer.ok) {
      throw new RefusedError(`teamrig kit uninstall: ${target}: ${answer.problem}; nothing removed`);
    }
    removals.push({ host: port.host, target, file: answer.value.file, removed: answer.value.counts.removed });
  }
  return removals;
}

/**
 * `teamrig kit uninstall [--yes]`: takes teamrig's handlers out of each hooks file of the person's whose host runs the
 * kit launcher (the person's own handlers stay, the old file is kept in the kit's backups folder first), then removes
 * the launcher, the records naming the version in use and every kept version, under the install lock. The teams, the
 * backups and the install clone stay. Without `--yes` it counts what would go and removes nothing; any hooks file it
 * cannot edit refuses the run before anything is written. Its write is a settings writer's (src/core/settings-writers.ts):
 * it changes a host's hooks, so only the person runs it.
 */
export async function kitUninstall(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const kitHome = kitHomeOf(runtime);
  const removals = await hooksRemovals(runtime, kitHome);
  const parts = await kitInstallParts(runtime.files, kitHome);
  const stays = `NOTE ${join(kitHome, 'teams')}, the backups and the install clone stay; a host's teamrig plugin installs teamrig again at its next session start, so remove the plugin first`;
  if (!args.switches.has(WRITE_SWITCH)) {
    const preview = `PREVIEW nothing removed (add --${WRITE_SWITCH} to remove)`;
    for (const removal of removals) {
      runtime.out.stdout(removal.file === undefined ? `UNCHANGED ${removal.target}: it holds none of teamrig's handlers` : `${preview} ${removal.target}: removed ${removal.removed}`);
    }
    runtime.out.stdout(`${preview} ${kitHome}: versions ${countedList(parts.versions)}; files ${countedList(parts.files)}`);
    runtime.out.stdout(stays);
    return EXIT.ok;
  }
  // The lines go first: a line left running a removed launcher would fail every hook call of its host.
  for (const removal of removals) {
    if (removal.file === undefined) continue;
    const target = { configPath: removal.target, backupsDir: join(kitHome, 'backups'), backupName: `${removal.host}-hooks` };
    const backup = await writeConfigWithBackup(runtime.files, target, removal.file, runtime.clock);
    runtime.out.stdout(`WROTE ${removal.target}: removed ${removal.removed}; the old file is at ${backup}`);
  }
  const outcome = await uninstallKit({ files: runtime.files, tree: runtime.kitTree, kitHome, lock: commandLockOf(runtime, kitHome) });
  if (outcome.kind === 'busy') {
    throw new RefusedError(`teamrig kit uninstall: ${KIT_LOCK_BUSY}; the hooks files above no longer run it: run this again to remove the kit home`);
  }
  runtime.out.stdout(`REMOVED ${countedList(outcome.removed)}`);
  runtime.out.stdout(stays);
  if (outcome.failed.length > 0) {
    runtime.out.stdout(`NOTE left in place, a running process holds a file in it: ${outcome.failed.join(', ')}; run it again once that process ends`);
    return EXIT.failed;
  }
  return EXIT.ok;
}
