import type { Task } from '../register/fold.ts';
import { byUrgency } from '../wake/decide.ts';

/** A running session a team's tab cap may close: its id, and the most urgent work it could start now (none: undefined). */
export interface CapCandidate {
  readonly id: string;
  readonly top: Task | undefined;
}

/**
 * The order a team over its tab cap closes sessions in: the ones with no work to start first, then the least urgent
 * top task first (`byUrgency` turned round), the id breaking ties so every run agrees.
 */
export function byCloseOrder(a: CapCandidate, b: CapCandidate): number {
  if (a.top === undefined || b.top === undefined) {
    return Number(b.top === undefined) - Number(a.top === undefined) || a.id.localeCompare(b.id);
  }
  return byUrgency(b.top, a.top) || a.id.localeCompare(b.id);
}

/**
 * The candidates a team with `open` tabs closes to get down to `maxTabs`, in close order: the `open - maxTabs`
 * lowest-ranked. None at or under the cap, or with no cap set. A candidate something else keeps open (a turn under
 * way, background work) still takes its place in the count, so the cap never closes more urgent work around it.
 */
export function overTabCap(candidates: readonly CapCandidate[], open: number, maxTabs: number | undefined): readonly CapCandidate[] {
  if (maxTabs === undefined || open <= maxTabs) {
    return [];
  }
  return [...candidates].sort(byCloseOrder).slice(0, open - maxTabs);
}

/** Why the cap holds a session's work: `the team has <n> tabs open, over its cap of <m> (open.headroom.maxTabs)`. */
export function tabCapHoldText(open: number, maxTabs: number): string {
  return `the team has ${open} tabs open, over its cap of ${maxTabs} (open.headroom.maxTabs)`;
}
