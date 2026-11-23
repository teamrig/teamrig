import type { HostSource, ShippedHosts } from '../composition/host-ports.ts';
import { KIT_NAME } from '../core/home.ts';
import { UsageError } from './args.ts';
import { RefusedError } from './runtime.ts';

/** The `hosts` of the team a run is for (its config's list), or undefined when no team config loads. */
export type TeamHosts = () => Promise<readonly string[] | undefined>;

/** The hosts a process starts with: the default host's ports and every shipped adapter's by id. */
export interface StartingHosts {
  readonly host: HostSource;
  readonly shippedHosts: ShippedHosts;
}

/**
 * The host a run works in (T4752). The process names it: each host's hooks file writes `--host <id>` into its hook
 * lines, so a team mixing hosts loads each session's own. A named id teamrig does not ship is a usage error; one the
 * team's `hosts` does not list is refused, as its files were never installed for the team. A run naming none, such as
 * a bare command in a terminal, takes the first of the team's `hosts`, else the default host.
 *
 * The team's config is read only when more than one host ships: `hosts` keeps only shipped ids, so with one shipped
 * host it can only list that one, and a hook pays no config read for an answer it cannot change.
 */
export async function chooseHost(command: string, named: string | undefined, starting: StartingHosts, teamHosts: TeamHosts): Promise<HostSource> {
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
