import { join } from 'node:path';
import { errorMessage } from '../../core/guards.ts';
import { resolveKitHome } from '../../core/home.ts';
import { resolveTeam } from '../../core/team.ts';
import { foldIntoFiveHourSummary } from '../../budget/five-hour-summary.ts';
import { datedSnapshot, defaultSnapshotDir, formatSnapshot, parseSnapshot, pruneSnapshots, snapshotDirOf, type StatusSnapshot } from '../../budget/snapshot.ts';
import { foldIntoWeekSummary } from '../../budget/week-summary.ts';
import { openKit, teamFolders } from '../kit.ts';
import type { LoadedTeam } from '../root-team.ts';
import type { CliRuntime } from '../runtime.ts';

/**
 * The team a session in `cwd` works in, its config loaded; undefined outside a team or with its config unreadable.
 * `cwd` is read before the run's own folder, and an empty one is passed over.
 */
export async function teamAt(runtime: CliRuntime, cwd: string): Promise<LoadedTeam | undefined> {
  const found = await resolveTeam(runtime.files, runtime.env, teamFolders(runtime, [cwd === '' ? undefined : cwd, runtime.cwd]));
  if (found.kind !== 'team') {
    return undefined;
  }
  const kit = await openKit(runtime, found.team);
  return kit.load.status === 'loaded' ? { kit, config: kit.load.config } : undefined;
}

/** The snapshot folder of `team` (`snapshotDirOf`), else, outside a team, the kit's default one. */
export function snapshotDirOfTeam(runtime: CliRuntime, team: LoadedTeam | undefined): string {
  return team === undefined ? defaultSnapshotDir(resolveKitHome(runtime.env, runtime.userHome)) : snapshotDirOf(team.config.budget, team.kit.paths);
}

/** The snapshot folder of the team a session in `cwd` works in (`teamAt`, `snapshotDirOfTeam`). */
export async function snapshotDirAt(runtime: CliRuntime, cwd: string): Promise<string> {
  return snapshotDirOfTeam(runtime, await teamAt(runtime, cwd));
}

/**
 * Saves `snapshot` as its session's file in `dir`, dated by the session's previous snapshot (`datedSnapshot`), folds it
 * into the folder's week and five-hour summaries and prunes the folder's old snapshots. A failed write throws; a failed
 * fold or prune is told on stderr under `who` (the command's name, as `teamrig statusline`), never stopping the rest.
 * Returns the snapshot as saved.
 */
export async function saveSnapshot(runtime: CliRuntime, dir: string, snapshot: StatusSnapshot, who: string): Promise<StatusSnapshot> {
  const path = join(dir, `${snapshot.sessionId}.json`);
  const previous = await runtime.files.read(path);
  const dated = datedSnapshot(snapshot, previous === undefined ? undefined : parseSnapshot(previous));
  await runtime.files.write(path, formatSnapshot(dated));
  await foldQuietly(runtime, dir, dated, who);
  await pruneQuietly(runtime, dir, who);
  return dated;
}

/** Folds the saved snapshot into the folder's summaries; a failure is told on stderr, never stopping the other fold. */
async function foldQuietly(runtime: CliRuntime, dir: string, snapshot: StatusSnapshot, who: string): Promise<void> {
  try {
    await foldIntoWeekSummary(runtime.files, dir, snapshot, runtime.clock.now());
  } catch (error) {
    runtime.out.stderr(`${who}: the week summary was not updated: ${errorMessage(error)}`);
  }
  try {
    await foldIntoFiveHourSummary(runtime.files, dir, snapshot);
  } catch (error) {
    runtime.out.stderr(`${who}: the five-hour summary was not updated: ${errorMessage(error)}`);
  }
}

/** Prunes the folder's old snapshots and left temporaries (`pruneSnapshots`); a failure is told on stderr. */
async function pruneQuietly(runtime: CliRuntime, dir: string, who: string): Promise<void> {
  try {
    await pruneSnapshots(runtime.files, dir, runtime.clock.now());
  } catch (error) {
    runtime.out.stderr(`${who}: old snapshots were not pruned: ${errorMessage(error)}`);
  }
}
