import type { Roster } from '../config/roster.ts';
import type { KitConfig } from '../config/types.ts';
import { runningPlaces } from '../sessions/measure.ts';
import { overTabCap, tabCapHoldText, type CapCandidate } from '../sessions/tab-cap.ts';
import { teamTabsNow } from './headroom.ts';
import { neverClosedWhy, startableOf, type IdleFacts } from './idle-check.ts';
import { restCapOf } from './idle-pass.ts';
import type { Kit } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

/** A team over its tab cap: the tabs it has open, its cap, and the sessions it closes to get down to it, in close order. */
export interface TabCapExcess {
  readonly open: number;
  readonly maxTabs: number;
  readonly toClose: readonly CapCandidate[];
}

/**
 * The team's excess over `open.headroom.maxTabs`: undefined with no cap set or at most that many tabs open (its
 * sessions running and its tabs still loading). Its candidates are its running sessions `neverClosedWhy` lets close,
 * each with its top work weighed as `teamrig close` weighs it (`restCapOf`: work its budget holds is not startable),
 * ranked by `overTabCap`. Each candidate's budget is read, so it runs only past the cap.
 */
export async function tabCapExcessOf(runtime: CliRuntime, kit: Kit, config: KitConfig, roster: Roster, facts: IdleFacts): Promise<TabCapExcess | undefined> {
  const { maxTabs } = config.open.headroom;
  if (maxTabs === undefined) {
    return undefined;
  }
  const running = runningPlaces(facts.places).map((place) => place.id);
  const open = await teamTabsNow(runtime, kit.paths, config, running);
  if (open <= maxTabs) {
    return undefined;
  }
  const candidates: CapCandidate[] = [];
  for (const id of running) {
    if (neverClosedWhy(config, roster, facts, id) !== undefined) {
      continue;
    }
    const cap = await restCapOf(runtime, kit, config, roster, { id, tasks: facts.tasks, elsewhere: facts.elsewhere }, Number.POSITIVE_INFINITY);
    candidates.push({ id, top: startableOf(config, facts, id, cap)[0] });
  }
  return { open, maxTabs, toClose: overTabCap(candidates, open, maxTabs) };
}

/** Why the cap holds `id`'s work (`tabCapHoldText`), when `id` is among the sessions its team closes to get under it. */
export function tabCapHoldOf(excess: TabCapExcess | undefined, id: string): string | undefined {
  if (excess === undefined || !excess.toClose.some((each) => each.id === id)) {
    return undefined;
  }
  return tabCapHoldText(excess.open, excess.maxTabs);
}
