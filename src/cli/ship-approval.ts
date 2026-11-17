import { LeadTree } from '../config/lead-tree.ts';
import type { KitConfig } from '../config/types.ts';
import { formatAddress, type SessionAddress } from '../core/address.ts';
import { githubWatcher } from '../sync/watcher.ts';
import { GENERIC_REVIEW_PATHS } from '../push-guard/review-paths.ts';
import type { Task } from '../register/fold.ts';
import type { TaskStatus } from '../register/model.ts';
import { JsonlEventLog } from '../register/store.ts';
import { openKit, rosterOf, sessionIdOf, type KitReader } from './kit.ts';
import { RefusedError } from './runtime.ts';
import { tabSessionOf } from './tab-session.ts';
import { leadAboveOf } from './tree.ts';

/**
 * What the ship tool's merge reads from the register before it lets a branch merge (tools/ship/approval.ts, T2788):
 * who calls, the branch's task, and who may approve the caller's merge, read the way the push guard reads them
 * (hook-guard-outputs.ts `pushClearanceOf`).
 */
export interface MergeStanding {
  /** The calling session's id. */
  readonly caller: string;
  /** The task the register holds by the branch's id now; undefined when it holds none. */
  readonly task: Task | undefined;
  /**
   * Whose approval clears the caller's merge: its leaders, nearest first; for a child team's lead, the parent team's
   * lead as `<team>/<id>` (T1140); none for a root team's lead, whose own merge needs no approval.
   */
  readonly approvers: readonly string[];
  /** The session that answers on GitHub (`githubWatcher`), whose own approval of its head clears a low-risk merge (T3448). */
  readonly answerer: string;
  /**
   * The globs (`github.lowRiskPaths`) that every path of a low-risk change matches (T3448, security verdict): a path
   * matching none is sensitive, so a path added later is too until the team lists it.
   */
  readonly lowRisk: readonly string[];
  /**
   * The review globs a change must touch none of to be low-risk, low-risk paths too (T3448): the generic review paths,
   * then `pushGuard.reviewPaths`, then `github.sensitivePaths`.
   */
  readonly sensitive: readonly string[];
  /** The team's security reviewer, who passes a sensitive change before the GitHub answerer merges it (T3448). */
  readonly securityReviewer: string | undefined;
  /** The owners of the tasks not shipped yet (open, in progress or waiting), by task id, whose branches a change may overlap (T3448). */
  readonly open: ReadonlyMap<string, string>;
}

/** The statuses of a task whose branch is still to land: a verifying or finished one shipped it already. */
const UNSHIPPED: readonly TaskStatus[] = ['open', 'in-progress', 'waiting'];

/**
 * The merge standing of `callerText` (an id or a name, from `$TEAMRIG_SESSION`) on team `team` for task `taskId`.
 * Refused when the team's config does not load, the caller is no session of the team, or the caller is a child team's
 * lead whose parent team has no config to name who approves it.
 */
export async function mergeStandingOf(reader: KitReader, team: string, callerText: string, taskId: string): Promise<MergeStanding> {
  const kit = await openKit(reader, team);
  if (kit.load.status !== 'loaded') {
    throw new RefusedError(`team ${team}'s config at ${kit.load.path} is ${kit.load.status}: the merge cannot tell who approves it`);
  }
  const { config } = kit.load;
  const caller = sessionIdOf(await rosterOf(reader, kit, config), callerText);
  const { state } = await new JsonlEventLog(reader.files, kit.paths.events).read();
  return {
    caller,
    task: state.tasks.get(taskId),
    approvers: await approversOf(reader, team, config, caller),
    answerer: githubWatcher(config),
    lowRisk: config.github.lowRiskPaths,
    sensitive: [...[...GENERIC_REVIEW_PATHS, ...config.pushGuard.reviewPaths].map((entry) => entry.glob), ...config.github.sensitivePaths],
    securityReviewer: config.roles.securityReviewer,
    open: new Map([...state.tasks.values()].filter((task) => UNSHIPPED.includes(task.status)).map((task) => [task.id, task.owner])),
  };
}

/**
 * The session a merge runs for (T2984, security condition C4): the one session of team `team` that the merging Claude
 * Code tab `hostSession` is bound to (`tabSessionOf`), which must be the one `callerText` (`$TEAMRIG_SESSION`) names,
 * so a typed name moves no merge to another session's task. Refused when the config does not load or the tab is not
 * bound to that session alone.
 */
export async function tabCallerOf(reader: KitReader, team: string, hostSession: string, callerText: string): Promise<string> {
  const kit = await openKit(reader, team);
  if (kit.load.status !== 'loaded') {
    throw new RefusedError(`team ${team}'s config at ${kit.load.path} is ${kit.load.status}: the merge cannot tell which session its tab is`);
  }
  const roster = await rosterOf(reader, kit, kit.load.config);
  const bound = await tabSessionOf(reader.files, kit.paths.inboxMarks, roster, hostSession, callerText);
  if (bound === undefined) {
    throw new RefusedError(
      `this Claude Code tab is not bound to ${callerText} alone: a merge runs from the merging session's own tab, whose every inbox mark names that session (a tab that read another session's inbox merges nothing)`,
    );
  }
  return bound;
}

/** {@link approversIn} for `caller`, reading the parent team's lead when `caller` leads a child team. */
export async function approversOf(reader: KitReader, team: string, config: KitConfig, caller: string): Promise<string[]> {
  const above = caller === config.roles.lead && config.team?.parent !== undefined ? await leadAboveOf(reader, team, config) : undefined;
  return approversIn(team, config, caller, above);
}

/**
 * Whose approval clears `caller`'s landing on team `team` (MergeStanding.approvers): its leaders, nearest first; for a
 * child team's lead, `above`, the parent team's lead (T1140); none for a root team's lead. Shared by the ship tool's
 * merge and `teamrig pr` (T4817). Refused for a child team's lead when `above` is undefined, as the parent team then
 * has no config to name who approves it.
 */
export function approversIn(team: string, config: KitConfig, caller: string, above: SessionAddress | undefined): string[] {
  if (caller !== config.roles.lead) {
    return new LeadTree(config).chainOf(caller);
  }
  const parent = config.team?.parent;
  if (parent === undefined) {
    return [];
  }
  if (above === undefined) {
    throw new RefusedError(`team ${parent}, the parent team, has no config to name its lead, who approves the merges of ${team}'s lead`);
  }
  return [formatAddress(above)];
}
