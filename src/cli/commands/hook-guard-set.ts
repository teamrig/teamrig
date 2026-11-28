import { errorMessage } from '../../core/guards.ts';
import { combinedGuardReply, type GuardAnswer } from '../../hooks/guard-set.ts';
import { passRecordGuardReply } from '../../hooks/pass-record-guard.ts';
import type { HookEvent, HookReply } from '../../ports/host/index.ts';
import type { ParsedArgs } from '../args.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf, type GuardLoad } from './hook-guard-load.ts';
import { membersNamed } from './hook-set-names.ts';
import { dbWriteGuardReplyOf, execGuardReplyOf, installGuardReplyOf, packageGuardReplyOf, pushGuardReplyOf, secretGuardReplyOf, serviceRoleGuardReplyOf } from './hook-guard-outputs.ts';
import { readHookInput, writeReply } from './hook-input.ts';
import { pickerGuardReplyOf } from './hook-picker-guard.ts';
import { readonlyAllowReplyOf } from './hook-readonly-allow.ts';
import { routeAllowReplyOf, type RouteAllowDeps } from './hook-route-allow.ts';

/**
 * `hook guards <name> ...` (T5553, T5821): the PreToolUse hooks a host runs on one tool call, in one process and one CLI
 * load, where each `hook <name>` once started its own process and loaded the whole CLI again. They read the same input
 * and the same config load, run side by side, and answer as one reply, combined as the host combines separate hooks
 * (hooks/guard-set.ts), so any refusal beats any allow. A guard that throws refuses the call, naming it; a member that
 * only ever allows, or that prints nothing on an error when it runs alone, gives no answer when it throws, as alone.
 */

/** One member's reply to the call, built as its own `hook <name>` builds it. */
type MemberReplyOf = (runtime: CliRuntime, guard: GuardLoad, event: HookEvent) => Promise<HookReply | undefined> | HookReply | undefined;

/**
 * What a member's throw means: `refuse` for a guard, which must not let a call through when it cannot answer; `pass`
 * for a member whose own hook prints nothing on an error, so the other members and the host's own check decide.
 */
export type OnThrow = 'refuse' | 'pass';

/** A hook that may run in a set: its reply and what its throw means. */
export interface SetMember {
  readonly reply: MemberReplyOf;
  readonly onThrow: OnThrow;
}

/** What the set's members take from the CLI: route-allow's command table, given so this module never imports run.ts. */
export type GuardSetDeps = RouteAllowDeps;

const guardMember = (reply: MemberReplyOf): SetMember => ({ reply, onThrow: 'refuse' });
const passMember = (reply: MemberReplyOf): SetMember => ({ reply, onThrow: 'pass' });

/**
 * The hooks a set may name, each with its reply and failure mode. guard-runner.ts `SET_GUARDS` names the same
 * (hook-guard-set.test.ts holds the two equal), since the runner may import nothing.
 */
export function setMembersOf(deps: GuardSetDeps): ReadonlyMap<string, SetMember> {
  return new Map<string, SetMember>([
    ['push-guard', guardMember(pushGuardReplyOf)],
    ['package-guard', guardMember(packageGuardReplyOf)],
    ['secret-guard', guardMember(secretGuardReplyOf)],
    ['db-write-guard', guardMember(dbWriteGuardReplyOf)],
    ['exec-guard', guardMember(execGuardReplyOf)],
    ['pass-record-guard', guardMember((_runtime, _guard, event) => passRecordGuardReply(event))],
    ['install-guard', guardMember((runtime, _guard, event) => installGuardReplyOf(runtime, event))],
    ['service-role-guard', guardMember(serviceRoleGuardReplyOf)],
    ['picker-guard', passMember((runtime, _guard, event) => pickerGuardReplyOf(runtime, event))],
    ['readonly-allow', passMember((runtime, _guard, event) => readonlyAllowReplyOf(runtime, event))],
    ['route-allow', passMember((runtime, _guard, event) => routeAllowReplyOf(runtime, event, deps))],
  ]);
}

/**
 * One member's answer: what it replied, or why it could not, a throw caught so the other members still answer. A
 * `pass` member's throw is no answer.
 */
async function answerOf(name: string, member: SetMember, runtime: CliRuntime, guard: GuardLoad, event: HookEvent): Promise<GuardAnswer> {
  try {
    return { guard: name, kind: 'replied', reply: await member.reply(runtime, guard, event) };
  } catch (error) {
    if (member.onThrow === 'pass') {
      return { guard: name, kind: 'replied', reply: undefined };
    }
    return { guard: name, kind: 'failed', cause: errorMessage(error).split(/\r?\n/u, 1)[0] ?? '' };
  }
}

/**
 * PreToolUse on the tools the named members watch: runs them on the one call and prints their combined reply. Outside
 * a team's projects, or for input that is no hook payload, it prints nothing, as each member's own hook does.
 */
export function guardSet(deps: GuardSetDeps): (args: ParsedArgs, runtime: CliRuntime) => Promise<ExitCode> {
  return guardSetOf(setMembersOf(deps));
}

/** The set over the given members, for a spec of a member's failure mode; `guardSet` gives it the shipped ones. */
export function guardSetOf(members: ReadonlyMap<string, SetMember>): (args: ParsedArgs, runtime: CliRuntime) => Promise<ExitCode> {
  return async (args, runtime) => {
    const named = membersNamed(args, members, 'guard');
    const { event } = await readHookInput(runtime);
    const guard = await guardLoadOf(event?.cwd, runtime);
    if (guard === undefined || event === undefined) {
      return EXIT.ok;
    }
    const answers = await Promise.all(named.map(([name, member]) => answerOf(name, member, runtime, guard, event)));
    writeReply(runtime, 'tool-start', combinedGuardReply(answers));
    return EXIT.ok;
  };
}
