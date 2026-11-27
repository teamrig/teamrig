import { errorMessage } from '../../core/guards.ts';
import { combinedReply } from '../../hooks/guard-set.ts';
import type { HookEvent, HookReply } from '../../ports/host/index.ts';
import type { ParsedArgs } from '../args.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { readHookInput, writeReply } from './hook-input.ts';
import { membersNamed } from './hook-set-names.ts';

/**
 * `hook after <hook> ...` (T5821): the PostToolUse hooks a host runs on one tool call, in one process and one CLI load,
 * where each `hook <name>` once started its own process and loaded the whole CLI again. They read the same input, run
 * side by side, and answer as one reply, combined as the host combines separate hooks (hooks/guard-set.ts): the
 * replaced tool output from the first that gives one (only secret-redact does), the lines for the model joined in the
 * set's order. A member that throws gives no answer and leaves one line on stderr naming it, so the others still
 * answer; none of them can refuse anything after the call has run.
 */

/** One member's reply to the call, built as its own `hook <name>` builds it. */
export type AfterMember = (runtime: CliRuntime, event: HookEvent) => Promise<HookReply | undefined> | HookReply | undefined;

/** A member's module, loaded only when the set names it, as run.ts loads each `hook <name>` alone. */
export type AfterMemberLoad = () => Promise<AfterMember>;

/** The PostToolUse hooks an `after` set may name, each with the load of its reply. */
export const AFTER_MEMBERS: ReadonlyMap<string, AfterMemberLoad> = new Map<string, AfterMemberLoad>([
  ['secret-redact', async () => (await import('./hook-secret-redact.ts')).secretRedactReplyOf],
  ['loop-nudge', async () => (await import('./hook-loop-nudge.ts')).loopNudgeReplyOf],
  ['missing-cli', async () => (await import('./hook-missing-cli.ts')).missingCliReplyOf],
  ['failed-send', async () => (await import('./hook.ts')).failedSendReplyOf],
  ['route-reminder', async () => (await import('./hook.ts')).routeReminderReplyOf],
]);

/** One member's reply, or none when its load or its reply throws, which it names on stderr. */
async function replyOrNone(name: string, load: AfterMemberLoad, runtime: CliRuntime, event: HookEvent): Promise<HookReply | undefined> {
  try {
    const member = await load();
    return await member(runtime, event);
  } catch (error) {
    runtime.out.stderr(`teamrig hook after: ${name} gave no answer: ${errorMessage(error).split(/\r?\n/u, 1)[0] ?? ''}`);
    return undefined;
  }
}

/**
 * PostToolUse (and PostToolUseFailure) on the tools the named members watch: runs them on the one call and prints
 * their combined reply, to the event the call ended in. For input that is no hook payload it prints nothing.
 */
export function afterSetOf(members: ReadonlyMap<string, AfterMemberLoad>): (args: ParsedArgs, runtime: CliRuntime) => Promise<ExitCode> {
  return async (args, runtime) => {
    const named = membersNamed(args, members, 'hook');
    const { event } = await readHookInput(runtime);
    if (event === undefined) {
      return EXIT.ok;
    }
    const replies = await Promise.all(named.map(([name, load]) => replyOrNone(name, load, runtime, event)));
    writeReply(runtime, event.name === 'tool-failed' ? 'tool-failed' : 'tool-end', combinedReply(replies));
    return EXIT.ok;
  };
}

/** `hook after` over the shipped members. */
export const hookAfter = afterSetOf(AFTER_MEMBERS);
