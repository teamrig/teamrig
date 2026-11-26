import { resolveKitHome } from '../../core/home.ts';
import { WRITE_SWITCH } from '../../core/settings-writers.ts';
import type { Mutex } from '../../core/lock.ts';
import { KIT_VERSION } from '../../core/version.ts';
import { clientRootOf } from '../../exec/client-integrity.ts';
import { syncKitLauncher } from '../../kit/hook-launcher.ts';
import { installRunningKit, KIT_COMMAND_LOCK, kitInstallLockPath, kitSelfInstallNote } from '../../kit/kit-self-install.ts';
import {
  damagedPreviewWhy,
  KIT_LOCK_BUSY,
  kitLeftovers,
  listKitVersions,
  planKitUse,
  prunableKitVersions,
  pruneKitVersions,
  readKitCurrent,
  useKitVersion,
  kitVersionFolder,
  type KitCurrent,
  type KitSource,
  type KitUseTarget,
} from '../../kit/kit-versions.ts';
import { noPositionals, requiredFlag, UsageError, type ParsedArgs } from '../args.ts';
import { fileLockOf, type FileLockRuntime } from '../file-locks.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `teamrig kit ...`: teamrig's own install under the kit home (src/kit/kit-versions.ts), the copy of each release a
 * session start ran, one named current; hosts run it once their hooks point at the kit home. `kit versions` lists
 * what is kept, `kit use` moves which one is current, `kit prune` removes the ones past the rollback window.
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

type KitInstallRuntime = KitRuntime & Pick<CliRuntime, 'self'>;

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
 * before `teamrig setup hooks`. Without `--yes` it shows the install and writes nothing. Its write is a settings
 * writer's (src/core/settings-writers.ts): it moves the code every host's guards run, so only the person runs it.
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
    return EXIT.ok;
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
  switch (outcome.kind) {
    case 'skipped':
      if (outcome.why === 'no-integrity-list') {
        throw new RefusedError(`teamrig kit install: ${clientRoot} holds no integrity list, so it is no built release; nothing written`);
      }
      runtime.out.stdout(`UNCHANGED ${release} runs from the kit home already`);
      break;
    case 'busy':
      throw new RefusedError(`teamrig kit install: ${KIT_LOCK_BUSY}`);
    case 'refused':
      throw new RefusedError(`teamrig kit install: ${outcome.why}`);
    case 'installed':
      runtime.out.stdout(`WROTE current ${outcome.version}${outcome.previous === undefined ? '' : ` (was ${outcome.previous})`}: ${release}`);
      break;
    case 'current':
      runtime.out.stdout(`UNCHANGED current ${outcome.version} is installed already`);
      break;
    case 'pinned':
    case 'older':
      runtime.out.stdout(`NOTE ${kitSelfInstallNote(outcome) ?? ''}`);
      break;
  }
  const launcher = await syncKitLauncher(runtime.files, kitHome);
  if (launcher.kind === 'missing') {
    runtime.out.stdout(`NOTE the kit launcher is not written: ${launcher.why}`);
    return EXIT.failed;
  }
  runtime.out.stdout(`${launcher.kind === 'written' ? 'WROTE' : 'UNCHANGED'} ${launcher.path}: the kit launcher of teamrig ${launcher.version}`);
  return EXIT.ok;
}
