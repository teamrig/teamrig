import { resolveTeam } from '../core/team.ts';
import { openKit, teamFolders } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

/**
 * The `hosts` of the team this run is for, found as `checkCommonFlags` finds it: `--team`, else `$TEAMRIG_TEAM` or a
 * pointer file. Undefined when no team is found or its config does not load, so `doctor` and `config validate` still
 * run on a broken one. Its own module, loaded only when `chooseHost` (host-choice.ts) needs the list: a hook that names
 * its host on a machine with one shipped host loads none of the config code.
 */
export async function teamHostsOf(runtime: CliRuntime, named: string | undefined): Promise<readonly string[] | undefined> {
  const found = named === undefined ? await resolveTeam(runtime.files, runtime.env, teamFolders(runtime, [runtime.cwd])) : undefined;
  const team = named ?? (found?.kind === 'team' ? found.team : undefined);
  if (team === undefined) {
    return undefined;
  }
  const { load } = await openKit(runtime, team);
  return load.status === 'loaded' ? load.config.hosts : undefined;
}
