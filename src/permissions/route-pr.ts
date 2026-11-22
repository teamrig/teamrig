import { parseIssueTarget } from '../issues/host.ts';
import { isFullCommitSha } from '../register/approval.ts';
import { kitCallOf, type KitContext } from './route-kit.ts';

/**
 * The pull request landing route (T5070, security verdict T5072 C1, C2): `teamrig pr approve|merge <owner/name#n>
 * --head <40 hex> [--session <own session>] [--check]`, nothing else. Both post as the person, so the route matches only
 * where teamrig itself gates them: where the calling session has a leader whose approval naming that head `pr` checks.
 * A root team's lead needs no one's approval, so for it the host's own check stays the only one before the post.
 */

/** Who clears a landing, read from the tab the call runs in. */
export interface LandingContext {
  /**
   * The leaders whose approval clears the landing of the session `named` (`--session`, else the session the hook's
   * environment names), when the call's tab is bound to that session alone; none when it is not, when the session has
   * no leader, or when the lookup fails.
   */
  readonly approversOf: (named: string | undefined) => Promise<readonly string[]>;
}

export const LANDING_COMMANDS: readonly string[] = ['pr approve', 'pr merge'];
const LANDING_FLAGS: readonly string[] = ['session', 'head'];
const LANDING_SWITCHES: readonly string[] = ['check'];

/** True when `words` land a pull request as the route allows, through this install's own teamrig. */
export async function matchesLanding(words: readonly string[], context: KitContext & LandingContext): Promise<boolean> {
  const call = kitCallOf(words, context.cli);
  if (call === undefined || !LANDING_COMMANDS.includes(call.parsed.command)) {
    return false;
  }
  const { flags, switches, common, positionals } = call.parsed;
  const [target, ...more] = positionals;
  const head = flags.get('head');
  const shaped =
    common.size === 0 &&
    [...flags.keys()].every((name) => LANDING_FLAGS.includes(name)) &&
    [...switches].every((name) => LANDING_SWITCHES.includes(name)) &&
    target !== undefined &&
    more.length === 0 &&
    parseIssueTarget(target) !== undefined &&
    head !== undefined &&
    isFullCommitSha(head);
  if (!shaped) {
    return false;
  }
  const approvers = await context.approversOf(flags.get('session'));
  return approvers.length > 0 && context.ownClient(call.program);
}
