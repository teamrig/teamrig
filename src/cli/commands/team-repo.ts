import { SecretScanner } from '../../core/secrets.ts';
import type { KitConfig } from '../../config/types.ts';
import { hostKindOf, type HostKind } from '../../issues/host.ts';
import { postRefusal } from '../../issues/write.ts';
import { RegisterPolicy } from '../../register/policy.ts';
import type { ParsedArgs } from '../args.ts';
import { CONNECTOR_OFF } from '../connector-off.ts';
import { callerOf } from '../inputs.ts';
import { hostsOf, type Hosts } from '../issue-hosts.ts';
import { sessionIdOf } from '../kit.ts';
import { RefusedError, type CliRuntime } from '../runtime.ts';
import { githubOffBy } from './issue-sync-auto.ts';
import { openTeam, type Team } from './register-team.ts';

/** A text to post and the flag that gave it, which a refusal names. */
export interface Posted {
  readonly flag: string;
  readonly text: string;
}

/** The caller's team and id, and the host kind of a repository of the team's that the caller may write to. */
export interface CheckedRepo {
  readonly team: Team;
  readonly caller: string;
  readonly config: KitConfig;
  readonly kind: HostKind;
}

/**
 * The team, the caller and `repo`'s host kind once the caller is on the team and the repository is one of the team's:
 * the checks every `issue` and `pr` write to a host takes first (T2679, T4817).
 */
export async function checkedRepo(args: ParsedArgs, runtime: CliRuntime, repo: string): Promise<CheckedRepo> {
  const team = await openTeam(runtime, 'read');
  const caller = sessionIdOf(team.roster, callerOf(args.flags, runtime.env));
  const notOnTeam = new RegisterPolicy(team.config, team.above).checkCaller(caller);
  if (notOnTeam !== undefined) {
    throw new RefusedError(notOnTeam);
  }
  const kind = hostKindOf(repo, team.config);
  if (kind === undefined) {
    const listed = team.config.github.repos.join(', ');
    throw new RefusedError(`${repo} is not one of the team's repositories: list it under github.repos in the team config${listed === '' ? '' : ` (now ${listed})`}`);
  }
  return { team, caller, config: team.config, kind };
}

/** Whether a command reads its host or writes to it, which the OFF line says it did not do. */
export type HostEffect = 'read' | 'write';

/**
 * The hosts of a checked repository once the text to post (if any) may be posted; undefined, after an OFF line saying
 * nothing was read or written (as `effect` says), while GitHub is off.
 */
export async function hostsAfter(checked: CheckedRepo, runtime: CliRuntime, posted: Posted | undefined, effect: HostEffect = 'write'): Promise<Hosts | undefined> {
  const { config, kind } = checked;
  const scanner = new SecretScanner(config.register.secretPatterns);
  const refused = posted === undefined ? undefined : postRefusal(posted.flag, posted.text, scanner);
  if (refused !== undefined) {
    throw new RefusedError(refused);
  }
  const offBy = githubOffBy(runtime.env);
  if (offBy !== undefined) {
    runtime.out.stdout(`OFF ${offBy}=${CONNECTOR_OFF} turns GitHub off on this machine; nothing was ${effect === 'read' ? 'read' : 'written'}`);
    return undefined;
  }
  return hostsOf(kind, runtime, scanner, config.github.stamp, config.connectors);
}
