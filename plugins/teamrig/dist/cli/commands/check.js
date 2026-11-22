import { LeadTree } from "../../config/lead-tree.js";
import { noPositionals } from "../args.js";
import { checkSeenOf, newFlags, newSinceLine } from "../check-seen.js";
import { callerOf } from "../inputs.js";
import { openTeamKit, requireConfig, rosterOf, sessionIdOf, teamZone } from "../kit.js";
import { checkLines, sessionCheck } from "../reports.js";
import { EXIT } from "../runtime.js";
import { checkReport } from "./register.js";
/**
 * `check [--tree] [--all] [--new]`: the report in the short form (src/cli/reports.ts), or with `--all` every flag in
 * full. `--new` (T2536) prints only the flags the session acts on, as its `start` does, that its last `start` or
 * `check --new` did not show, under a `NEW since` line naming when that was, then records them all as shown. A plain
 * `check` neither reads nor records what was shown: it stays the full view.
 */
export async function check(args, runtime) {
    noPositionals(args);
    const all = args.switches.has('all');
    if (!args.switches.has('new')) {
        checkLines(await checkReport(args, runtime), all).forEach((line) => runtime.out.stdout(line));
        return EXIT.ok;
    }
    const kit = await openTeamKit(runtime);
    const config = requireConfig(kit, runtime, 'read');
    const id = sessionIdOf(await rosterOf(runtime, kit, config), callerOf(args.flags, runtime.env));
    const report = sessionCheck(await checkReport(args, runtime), id, new LeadTree(config));
    const store = checkSeenOf(runtime.files, kit.paths, id);
    const seen = await store.read();
    runtime.out.stdout(newSinceLine(id, seen, teamZone(config, runtime)));
    checkLines(seen === undefined ? report : newFlags(report, seen.keys), all).forEach((line) => runtime.out.stdout(line));
    await store.record(report, runtime.clock.now());
    return EXIT.ok;
}
