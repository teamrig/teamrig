import { resolveKitHome } from '../../core/home.ts';
import { WRITE_SWITCH } from '../../core/settings-writers.ts';
import { kitLeftovers, listKitVersions, planKitUse, prunableKitVersions, pruneKitVersions, readKitCurrent, useKitVersion, type KitCurrent, type KitUseTarget } from '../../kit/kit-versions.ts';
import { noPositionals, UsageError, type ParsedArgs } from '../args.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `teamrig kit ...`: teamrig's own install under the kit home (src/kit/kit-versions.ts), the copy of each release that
 * every host's hook line runs through the kit home's launcher. `kit versions` lists what is kept, `kit use` moves which
 * one runs, `kit prune` removes the ones past the rollback window.
 */

const LATEST = 'latest';

type KitRuntime = Pick<CliRuntime, 'files' | 'kitTree' | 'env' | 'userHome' | 'out'>;

function kitHomeOf(runtime: KitRuntime): string {
  return resolveKitHome(runtime.env, runtime.userHome);
}

/** How a record names where its version came from. */
function sourceText(current: KitCurrent): string {
  const { source } = current;
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
 * (src/core/settings-writers.ts): it changes the code behind every host's guards, so only the person runs it.
 */
export async function kitUse(args: ParsedArgs, runtime: KitRuntime): Promise<ExitCode> {
  const target = useTargetOf(args);
  const ports = { files: runtime.files, kitHome: kitHomeOf(runtime) };
  if (!args.switches.has(WRITE_SWITCH)) {
    const plan = await planKitUse(ports, target);
    if (plan.kind === 'refused') {
      throw new RefusedError(`teamrig kit use: ${plan.why}`);
    }
    const from = plan.previous === undefined ? 'no version' : plan.previous.version;
    const pin = plan.next.pinned ? ', pinned' : ', no pin';
    runtime.out.stdout(`PREVIEW nothing written (add --${WRITE_SWITCH} to write): current ${from} -> ${plan.next.version}${pin}`);
    return EXIT.ok;
  }
  const outcome = await useKitVersion(ports, target);
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
  const outcome = await pruneKitVersions({ files: runtime.files, tree: runtime.kitTree, kitHome });
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
