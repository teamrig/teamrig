import { runningPlaces } from "../sessions/measure.js";
import { overTabCap, tabCapHoldText } from "../sessions/tab-cap.js";
import { teamTabsNow } from "./headroom.js";
import { neverClosedWhy, startableOf } from "./idle-check.js";
import { restCapOf } from "./idle-pass.js";
/**
 * The team's excess over `open.headroom.maxTabs`: undefined with no cap set or at most that many tabs open (its
 * sessions running and its tabs still loading). Its candidates are its running sessions `neverClosedWhy` lets close,
 * each with its top work weighed as `teamrig close` weighs it (`restCapOf`: work its budget holds is not startable),
 * ranked by `overTabCap`. Each candidate's budget is read, so it runs only past the cap.
 */
export async function tabCapExcessOf(runtime, kit, config, roster, facts) {
    const { maxTabs } = config.open.headroom;
    if (maxTabs === undefined) {
        return undefined;
    }
    const running = runningPlaces(facts.places).map((place) => place.id);
    const open = await teamTabsNow(runtime, kit.paths, config, running);
    if (open <= maxTabs) {
        return undefined;
    }
    const candidates = [];
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
export function tabCapHoldOf(excess, id) {
    if (excess === undefined || !excess.toClose.some((each) => each.id === id)) {
        return undefined;
    }
    return tabCapHoldText(excess.open, excess.maxTabs);
}
