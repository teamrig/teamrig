import { DEFAULT_SESSION_SHARE } from '../config/defaults.ts';
import type { SessionBudget } from '../config/types.ts';
import { formatAddress } from '../core/address.ts';
import { activeLift, isCrossTeamLift, type Lift } from './lift.ts';
import { workWeightOf, type WorkByPriority } from './work.ts';

/** How the team's daily budget is split among its sessions; every part moves with the budget it splits. */
export interface BudgetSplit {
  /** The team's id: its node when the account's daily budget is split among the teams on it. */
  readonly team: string;
  /** The team's sessions, the whole roster. */
  readonly ids: readonly string[];
  readonly sessions: Readonly<Record<string, SessionBudget>>;
  /** Each session's top queued task's weight under its priority (`workWeights`); a session not in it counts 1. */
  readonly work: ReadonlyMap<string, WorkByPriority>;
  /** The session lifts in force, as each lifted session's part of the team's budget in percent (`budgetSplitOf`). */
  readonly lifted: ReadonlyMap<string, number>;
  /**
   * The cross-team lifts in force the team's lead gave (T1631), as each lifted session's part of the team's budget in
   * percent, by its address `<team>/<id>`: taken out of the team's budget, on top of the session's own (`topUpOf`).
   */
  readonly crossLifted: ReadonlyMap<string, number>;
  /** The sessions a short day may pause (src/budget/pause.ts `pausableOf`): none while the team's `budget.pauseByPriority` is off. */
  readonly pausable: ReadonlySet<string>;
  /**
   * Each session's funded part of its weight on a short day, 0 to 1 (src/budget/pause.ts `fundByPriority`), 0 pausing
   * it; a session not in it is funded whole, as every session is on any other day.
   */
  readonly funded: ReadonlyMap<string, number>;
}

/** The team that asks (`split`) and the other teams on its Claude account (`accountTeamsOf`), which share the account's week. */
export interface TeamsOnAccount {
  readonly split: BudgetSplit;
  readonly others: readonly BudgetSplit[];
}

/** A session in the split tree. */
export interface SplitLeaf {
  readonly id: string;
  /** Its lift in force, as its part of its parent's budget in percent; undefined when not lifted. */
  readonly liftedPct: number | undefined;
  /** Its weight (`sessionWeightOf`) times its funded part on a short day. */
  readonly weight: number;
}

/** A node that splits its part among its nodes (a team on the account); its weight is theirs summed. */
export interface SplitGroup {
  readonly id: string;
  readonly liftedPct: number | undefined;
  readonly nodes: readonly SplitNode[];
}

export type SplitNode = SplitLeaf | SplitGroup;

function weightOf(node: SplitNode): number {
  return 'nodes' in node ? node.nodes.reduce((sum, each) => sum + weightOf(each), 0) : node.weight;
}

/**
 * A node's part of its parent's budget (`parentPct`, in percent of the week): a lifted node's is its lift's part of
 * it; what the lifts among `siblings` (the node among them) leave is split among the unlifted ones by weight.
 */
function partAmong(parentPct: number, node: SplitNode, siblings: readonly SplitNode[]): number {
  if (node.liftedPct !== undefined) {
    return (parentPct * node.liftedPct) / 100;
  }
  let liftedPct = 0;
  let weights = 0;
  for (const each of siblings) {
    if (each.liftedPct === undefined) {
      weights += weightOf(each);
    } else {
      liftedPct += each.liftedPct;
    }
  }
  const rest = (parentPct * Math.max(0, 100 - liftedPct)) / 100;
  return weights > 0 ? (rest * weightOf(node)) / weights : 0;
}

/**
 * The part of a budget (`budgetPct`, in percent of the week) that the node at `path` gets, `path` being its ids from
 * the top `nodes` down, split level by level (`partAmong`). Recomputed with the budget, so no node waits while the
 * week has room and the parts never add up to more than the budget. Undefined when no node is at `path`.
 */
export function partOf(budgetPct: number, nodes: readonly SplitNode[], path: readonly string[]): number | undefined {
  let pct = budgetPct;
  let level = nodes;
  let node: SplitNode | undefined;
  for (const id of path) {
    node = level.find((each) => each.id === id);
    if (node === undefined) {
      return undefined;
    }
    pct = partAmong(pct, node, level);
    level = 'nodes' in node ? node.nodes : [];
  }
  return node === undefined ? undefined : pct;
}

/** A session's `share`: the default for a session `budget.sessions` does not list. */
export function shareOf(split: Pick<BudgetSplit, 'sessions'>, id: string): number {
  return split.sessions[id]?.share ?? DEFAULT_SESSION_SHARE;
}

/** A session's weight in the split: its `share` times its top queued task's weight (`workWeights`), at least 1 so a session with none still gets a part. */
export function sessionWeightOf(split: Pick<BudgetSplit, 'sessions' | 'work'>, id: string): number {
  return shareOf(split, id) * Math.max(1, workWeightOf(split.work.get(id)));
}

/** A session as a split-tree leaf, weighed by its weight and funded part (`funded`), with its session lift in force. */
function leafOf(split: BudgetSplit, id: string): SplitLeaf {
  return { id, liftedPct: split.lifted.get(id), weight: sessionWeightOf(split, id) * (split.funded.get(id) ?? 1) };
}

/** The team's split tree, and where each session sits in it: its ids from the top down. */
export interface TeamTree {
  readonly nodes: readonly SplitNode[];
  /** Each session's path: its own id, as every session is a leaf at the top. */
  readonly sessionPaths: ReadonlyMap<string, readonly string[]>;
}

/**
 * The team as a split tree: each session a leaf at the top, in roster order, as the lead leads every session on the
 * team and a group with a lead of its own is a child team (T1320). Each cross-team lift in force is a lifted leaf of
 * weight 0 at the top, so it takes its part of the team's budget without moving the team's weight beside the other
 * teams on the account; it is no session of the team, so it has no path.
 */
export function teamTreeOf(split: BudgetSplit): TeamTree {
  const sessionPaths = new Map(split.ids.map((id) => [id, [id]] as const));
  const crossLifts = [...split.crossLifted].map(([id, liftedPct]): SplitLeaf => ({ id, liftedPct, weight: 0 }));
  return { nodes: [...split.ids.map((id) => leafOf(split, id)), ...crossLifts], sessionPaths };
}

/** The team as a split-tree node: its tree's top nodes (`teamTreeOf`) under its id, its weight theirs summed. */
function teamGroupOf(split: BudgetSplit, tree: TeamTree = teamTreeOf(split)): SplitGroup {
  return { id: split.team, liftedPct: undefined, nodes: tree.nodes };
}

/**
 * The team's part of an amount the account shares (`pct`, in percent of the week: its day, its spare), split among the
 * teams on the account (the team's `split` and the `others`, `accountTeamsOf`) by their sessions' summed weights: all
 * of it while no other team is on the account.
 */
export function teamShareOf(pct: number, split: BudgetSplit, others: readonly BudgetSplit[]): number {
  if (others.length === 0) {
    return pct;
  }
  const team = teamGroupOf(split);
  return partAmong(pct, team, [team, ...others.map((each) => teamGroupOf(each))]);
}

/**
 * The team's part (`teamShareOf`) of the account's daily budget (`allowancePct`), less what its cross-team lifts give
 * and plus what the teams above give its sessions (`topUpOf`), so it is what its sessions' parts add up to; undefined
 * while the account's is unknown.
 */
export function teamPartOf(allowancePct: number | undefined, split: BudgetSplit, others: readonly BudgetSplit[] = []): number | undefined {
  if (allowancePct === undefined) {
    return undefined;
  }
  const given = [...split.crossLifted.values()].reduce((sum, pct) => sum + pct, 0);
  const received = [...teamTreeOf(split).sessionPaths.keys()].reduce((sum, id) => sum + topUpOf(allowancePct, id, split, others), 0);
  return (teamShareOf(allowancePct, split, others) * Math.max(0, 100 - given)) / 100 + received;
}

/**
 * The session's daily budget now, in percent of the week: its part (`partOf`) of its team's part (`teamShareOf`) of
 * the account's (`allowancePct`), down its team's tree (`teamTreeOf`), plus what the teams above give it (`topUpOf`);
 * a lift is its part of the team's. Undefined while the account's is unknown, or for a session the tree does not hold.
 */
export function dailyBudgetOf(allowancePct: number | undefined, session: string, split: BudgetSplit, others: readonly BudgetSplit[] = []): number | undefined {
  if (allowancePct === undefined) {
    return undefined;
  }
  const tree = teamTreeOf(split);
  const path = tree.sessionPaths.get(session);
  const own = path === undefined ? undefined : budgetAt(allowancePct, path, split, tree, others);
  return own === undefined ? undefined : own + topUpOf(allowancePct, session, split, others);
}

/**
 * What the cross-team lifts in force of the team's session give it on top of its own part, in percent of the week:
 * each lifting team's (among `others`) lift's part of that team's part of the account's daily budget (`allowancePct`).
 */
function topUpOf(allowancePct: number, session: string, split: BudgetSplit, others: readonly BudgetSplit[]): number {
  const address = formatAddress({ team: split.team, id: session });
  const lifters = others.filter((each) => each.crossLifted.has(address));
  if (lifters.length === 0) {
    return 0;
  }
  const teams = [teamGroupOf(split), ...others.map((each) => teamGroupOf(each))];
  return lifters.reduce((sum, lifter) => sum + (partOf(allowancePct, teams, [lifter.team, address]) ?? 0), 0);
}

/**
 * The part of the account's daily budget (`allowancePct`) that the node at `path` in the team's tree (`tree`) gets:
 * of the team's part (`teamPartOf`) beside the `others`, of the whole day while no other team is on the account.
 */
function budgetAt(allowancePct: number, path: readonly string[], split: BudgetSplit, tree: TeamTree, others: readonly BudgetSplit[]): number | undefined {
  // With no other team the path skips the team level: an exact split of the day, not one an ulp off it.
  return others.length === 0
    ? partOf(allowancePct, tree.nodes, path)
    : partOf(allowancePct, [teamGroupOf(split, tree), ...others.map((each) => teamGroupOf(each))], [split.team, ...path]);
}

/** Where a lift takes its part from: the team's budget, beside the other lifts in force. */
export interface LiftPlace {
  /** The other lifts in force on the team, summed, in percent of its budget. */
  readonly liftedPct: number;
}

/** The other lifts in force at the top of the team's tree, summed; the one `id` already has is not counted, as a new one replaces it. */
function otherLiftsPct(split: BudgetSplit, id: string): number {
  return teamTreeOf(split).nodes.reduce((sum, each) => (each.id === id ? sum : sum + (each.liftedPct ?? 0)), 0);
}

/** The place (`LiftPlace`) of a lift of session `id`: undefined for a session not on the team. */
export function liftPlaceOf(split: BudgetSplit, id: string): LiftPlace | undefined {
  return split.ids.includes(id) ? { liftedPct: otherLiftsPct(split, id) } : undefined;
}

/**
 * What a lift of `partPct` of the team's daily budget comes to now, in percent of the week (T1637): that part of the
 * team's part (`teamShareOf`) of the account's day `allowancePct` beside the `others`, as `partAmong` gives a lifted
 * node. A cross-team lift is a part of the lifting team's, so of its `split`. Moves with the budget it is a part of;
 * undefined while the account's day is unknown.
 */
export function liftWeekPctOf(allowancePct: number | undefined, partPct: number, split: BudgetSplit, others: readonly BudgetSplit[] = []): number | undefined {
  return allowancePct === undefined ? undefined : (teamShareOf(allowancePct, split, others) * partPct) / 100;
}

/**
 * The place (`LiftPlace`) of a cross-team lift of the session at `address` (`<team>/<id>`): a part of the team's
 * budget, beside its other lifts at the top of its tree, cross-team ones included; the one `address` has is not counted.
 */
export function crossLiftPlaceOf(split: BudgetSplit, address: string): LiftPlace {
  return { liftedPct: otherLiftsPct(split, address) };
}

/** What `budgetSplitOf` splits by: the team's roster, shares, queued work and pausable sessions, and its lift log. */
export interface SplitSource extends Omit<BudgetSplit, 'lifted' | 'crossLifted' | 'funded'> {
  readonly lifts: readonly Lift[];
  /** The lifts in force at `now` with the week's use at `usedPct` (`activeLift`) count. */
  readonly now: number;
  readonly usedPct: number | undefined;
}

/** The team's split, with the session and cross-team lifts in force (`activeLift`) as their parts, every session funded whole. */
export function budgetSplitOf(source: SplitSource): BudgetSplit {
  const { lifts, now, usedPct, ...split } = source;
  const crossLifted = [...new Set(lifts.filter((lift) => isCrossTeamLift(lift)).map((lift) => lift.session))];
  return {
    ...split,
    lifted: partsInForce(split.ids, (id) => activeLift(lifts, id, now, usedPct)),
    crossLifted: partsInForce(crossLifted, (address) => activeLift(lifts, address, now, usedPct)),
    funded: new Map(),
  };
}

function partsInForce(ids: readonly string[], liftOf: (id: string) => Lift | undefined): ReadonlyMap<string, number> {
  const parts = new Map<string, number>();
  for (const id of ids) {
    const lift = liftOf(id);
    if (lift !== undefined) {
      parts.set(id, lift.partPct);
    }
  }
  return parts;
}

/** An id no roster holds (a session id starts with a lowercase letter), for the session `addedSessionPct` adds. */
const ADDED_SESSION = '+added';

/**
 * The part of the account's daily budget (`allowancePct`, in percent of the week) one more session of the team would
 * get: added at the top of its tree at the default share with no queued work, it takes its part out of the other
 * sessions' on the account (`others` being its other teams), as a new hire does.
 */
export function addedSessionPct(allowancePct: number, split: BudgetSplit, others: readonly BudgetSplit[] = []): number {
  return dailyBudgetOf(allowancePct, ADDED_SESSION, { ...split, ids: [...split.ids, ADDED_SESSION] }, others) ?? 0;
}
