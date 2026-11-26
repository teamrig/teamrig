import { errorMessage } from '../../core/guards.ts';
import { combinedGuardReply, type GuardAnswer } from '../../hooks/guard-set.ts';
import { passRecordGuardReply } from '../../hooks/pass-record-guard.ts';
import type { HookEvent, HookReply } from '../../ports/host/index.ts';
import { somePositionals, UsageError, type ParsedArgs } from '../args.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf, type GuardLoad } from './hook-guard-load.ts';
import { dbWriteGuardReplyOf, execGuardReplyOf, installGuardReplyOf, packageGuardReplyOf, pushGuardReplyOf, secretGuardReplyOf, serviceRoleGuardReplyOf } from './hook-guard-outputs.ts';
import { readHookInput, writeReply } from './hook-input.ts';

/**
 * `hook guards <name> ...` (T5553): the PreToolUse guards a host runs on one tool call, in one process and one CLI load,
 * where each `hook <name>` once started its own process and loaded the whole CLI again. They read the same input and
 * the same config load, run side by side, and answer as one reply, combined as the host combines separate hooks
 * (hooks/guard-set.ts). A guard that throws refuses the call, naming it.
 */

/** One guard's reply to the call, built as its own `hook <name>` builds it. */
type GuardReplyOf = (runtime: CliRuntime, guard: GuardLoad, event: HookEvent) => Promise<HookReply | undefined> | HookReply | undefined;

/**
 * The guards a set may name, each with its reply. guard-runner.ts `SET_GUARDS` names the same (hook-guard-set.test.ts
 * holds the two equal), since the runner may import nothing.
 */
export const SET_GUARD_REPLIES: ReadonlyMap<string, GuardReplyOf> = new Map<string, GuardReplyOf>([
  ['push-guard', pushGuardReplyOf],
  ['package-guard', packageGuardReplyOf],
  ['secret-guard', secretGuardReplyOf],
  ['db-write-guard', dbWriteGuardReplyOf],
  ['exec-guard', execGuardReplyOf],
  ['pass-record-guard', (_runtime, _guard, event) => passRecordGuardReply(event)],
  ['install-guard', (runtime, _guard, event) => installGuardReplyOf(runtime, event)],
  ['service-role-guard', serviceRoleGuardReplyOf],
]);

/** The guards the command line names, in its order, each once; a name of no set guard is a usage error. */
function guardsNamed(args: ParsedArgs): readonly (readonly [string, GuardReplyOf])[] {
  const names = somePositionals(args, 'guard');
  const unknown = names.find((name) => !SET_GUARD_REPLIES.has(name));
  if (unknown !== undefined) {
    throw new UsageError(`no guard named "${unknown}" runs in a set; the set's guards are ${[...SET_GUARD_REPLIES.keys()].join(', ')}`);
  }
  if (new Set(names).size !== names.length) {
    throw new UsageError('a guard is named twice');
  }
  return names.flatMap((name) => {
    const reply = SET_GUARD_REPLIES.get(name);
    return reply === undefined ? [] : [[name, reply] as const];
  });
}

/** One guard's answer: what it replied, or why it could not, a throw caught so the other guards still answer. */
async function answerOf(name: string, reply: GuardReplyOf, runtime: CliRuntime, guard: GuardLoad, event: HookEvent): Promise<GuardAnswer> {
  try {
    return { guard: name, kind: 'replied', reply: await reply(runtime, guard, event) };
  } catch (error) {
    return { guard: name, kind: 'failed', cause: errorMessage(error).split(/\r?\n/u, 1)[0] ?? '' };
  }
}

/**
 * PreToolUse on the tools the named guards watch: runs them on the one call and prints their combined reply. Outside a
 * team's projects, or for input that is no hook payload, it prints nothing, as each guard's own hook does.
 */
export async function guardSet(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const guards = guardsNamed(args);
  const { event } = await readHookInput(runtime);
  const guard = await guardLoadOf(event?.cwd, runtime);
  if (guard === undefined || event === undefined) {
    return EXIT.ok;
  }
  const answers = await Promise.all(guards.map(([name, reply]) => answerOf(name, reply, runtime, guard, event)));
  writeReply(runtime, 'tool-start', combinedGuardReply(answers));
  return EXIT.ok;
}
