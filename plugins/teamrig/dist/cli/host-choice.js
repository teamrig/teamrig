import { KIT_NAME } from "../core/home.js";
import { UsageError } from "./args.js";
import { RefusedError } from "./runtime.js";
/**
 * The host a run works in (T4752). The process names it: each host's hooks file writes `--host <id>` into its hook
 * lines, so a team mixing hosts loads each session's own. A named id teamrig does not ship is a usage error; one the
 * team's `hosts` does not list is refused, as its files were never installed for the team. A run naming none, such as
 * a bare command in a terminal, takes the first of the team's `hosts`, else the default host.
 *
 * The team's config is read only when more than one host ships: `hosts` keeps only shipped ids, so with one shipped
 * host it can only list that one, and a hook pays no config read for an answer it cannot change.
 */
export async function chooseHost(command, named, starting, teamHosts) {
    const { shippedHosts } = starting;
    const ids = Object.keys(shippedHosts);
    const several = ids.length > 1;
    if (named !== undefined) {
        const source = shippedHosts[named];
        if (source === undefined) {
            throw new UsageError(`--host ${named} names no host ${KIT_NAME} ships; it ships ${ids.join(', ')}`, command);
        }
        const listed = several ? await teamHosts() : undefined;
        if (listed !== undefined && !listed.includes(named)) {
            throw new RefusedError(`--host ${named} is not one of the team's hosts (${listed.join(', ')}): add it to hosts in the team config first`);
        }
        return source.ports;
    }
    if (!several) {
        return starting.host;
    }
    const [first] = (await teamHosts()) ?? [];
    return (first === undefined ? undefined : shippedHosts[first]?.ports) ?? starting.host;
}
