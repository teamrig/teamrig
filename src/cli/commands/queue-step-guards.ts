import { withoutSessionVariables } from '../../core/child-env.ts';
import { posixQuote } from '../../open/quote.ts';
import type { HookEvent, HookReply, ShellCall } from '../../ports/host/index.ts';
import { childEnvOf } from '../host.ts';
import type { Kit } from '../kit.ts';
import type { CliRuntime } from '../runtime.ts';
import { bashGuardAnswersOf } from './hook-guard-outputs.ts';

/**
 * A detached step's guard re-check (T4265): a parked step is a file any process of the user can write, so before the
 * queue runs one it puts the step's words through the same Bash guards a session's typed line meets, and refuses the
 * step on any refusal, whoever wrote the file. The check binds to no session: the parked environment names its parker
 * but anyone can write it, so a guard that clears by who asks (a review run as oneself, a lead's push) clears nothing.
 */

/** The line a session types to queue `words`; the guards read through `teamrig queue --` to the words it runs. */
export function queuedLineOf(words: readonly string[]): string {
  return `teamrig queue -- ${words.map(posixQuote).join(' ')}`;
}

/** The reason a guard's reply refuses the call with, or undefined when it lets the call go: no reply, a note or an allow. */
export function refusalOf(reply: HookReply | undefined): string | undefined {
  const verdict = reply?.verdict;
  return verdict === undefined || verdict.kind === 'allow' ? undefined : verdict.reason;
}

/**
 * The tool-start event of a Bash call that types `line` in `cwd`, from no host session: what a guard sees when a
 * session types the line, less who typed it.
 */
export function unboundShellEventOf(line: string, cwd: string): HookEvent {
  const call: ShellCall = { kind: 'shell', name: 'Bash', input: { command: line }, dialect: 'bash', command: line, readings: [line] };
  return {
    name: 'tool-start',
    hostName: undefined,
    session: undefined,
    cwd,
    transcript: undefined,
    title: undefined,
    helper: undefined,
    call,
    prompt: undefined,
    hostPrompt: false,
    lastReply: undefined,
    stopActive: false,
    source: undefined,
    reason: undefined,
    trigger: undefined,
    model: undefined,
    effort: undefined,
    message: undefined,
    error: undefined,
  };
}

/**
 * Why the Bash guards refuse the step's `words` run from `runtime.cwd` under the step's own team `kit`, or undefined
 * when they all let it go. The guards run with no teamrig or host session variable, so none reads the step as a
 * session's own. A guard that throws throws here, so the step does not run.
 */
export async function stepGuardRefusal(runtime: CliRuntime, kit: Kit, words: readonly string[]): Promise<string | undefined> {
  const unbound: CliRuntime = { ...runtime, env: withoutSessionVariables(runtime.env, childEnvOf(runtime).session) };
  const answers = await bashGuardAnswersOf(unbound, { kit, load: kit.load }, unboundShellEventOf(queuedLineOf(words), runtime.cwd));
  return answers.map(refusalOf).find((reason) => reason !== undefined);
}
