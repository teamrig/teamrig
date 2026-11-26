import type { HostSource, ShippedHosts } from '../composition/host-ports.ts';
import { KIT_NAME } from '../core/home.ts';
import { UsageError } from './args.ts';
import { RefusedError } from './runtime.ts';

/** The `hosts` of the team a run is for (its config's list), or undefined when no team config loads. */
export type TeamHosts = () => Promise<readonly string[] | undefined>;

/**
 * A run naming a shipped host the team's `hosts` does not list. It carries that host's ports, so a hook run can still
 * answer in the words its host reads (unlisted-host-hook.ts) rather than as a failed hook.
 */
export class UnlistedHostError extends RefusedError {
  readonly hostId: string;
  readonly listed: readonly string[];
  readonly ports: HostSource;

  constructor(hostId: string, listed: readonly string[], ports: HostSource) {
    super(`--host ${hostId} is not one of the team's hosts (${listed.join(', ')}): add it to hosts in the team config first`);
    this.hostId = hostId;
    this.listed = listed;
    this.ports = ports;
  }
}

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
      throw new UnlistedHostError(named, listed, source.ports);
    }
    return source.ports;
  }
  if (!several) {
    return starting.host;
  }
  const [first] = (await teamHosts()) ?? [];
  return (first === undefined ? undefined : shippedHosts[first]?.ports) ?? starting.host;
}
