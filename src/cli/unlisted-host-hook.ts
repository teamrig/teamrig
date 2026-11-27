import { KIT_NAME } from '../core/home.ts';
import { GUARD_HOOKS } from './guard-runner.ts';
import { readHookInput, writeReply } from './commands/hook-input.ts';
import type { UnlistedHostError } from './host-choice.ts';
import { EXIT, type CliRuntime, type ProcessExit } from './runtime.ts';

/** The hook that greets a session: the one that says, once, why the rest of the hooks are off. */
const GREETING_HOOK = 'hook session-start';

/** The text that tells the person and the model which line turns the hooks back on. */
export function unlistedHostNotice(error: Pick<UnlistedHostError, 'hostId' | 'listed'>): string {
  return (
    `${KIT_NAME}: this team's hosts (${error.listed.join(', ')}) does not list ${error.hostId}, so ${KIT_NAME}'s hooks are off in this ` +
    `session and its guards block every tool call. Add "${error.hostId}" to hosts in the team config, then start a new session.`
  );
}

/**
 * The answer a hook run gives when its line names a host the team does not list (T5735). The hooks file is per user and
 * outlives `setup hooks`' own check, so a team made after the install, or a second team on the machine, still runs
 * them. A guard keeps its refusal (undefined here): a guard that cannot run must block, never let a call through
 * (guard-runner.ts). Any other hook ends cleanly instead of failing: `hook session-start` says once, in the host's own
 * reply, which line to add, and the rest write nothing, so the host shows one clear line, not every hook failed.
 */
export async function answerUnlistedHost(
  command: string,
  error: UnlistedHostError,
  runtime: Pick<CliRuntime, 'readStdin' | 'out' | 'env' | 'platform' | 'hostEvent'>,
): Promise<ProcessExit | undefined> {
  const [group, name] = command.split(' ');
  if (group !== 'hook' || name === undefined || GUARD_HOOKS.has(name)) {
    return undefined;
  }
  if (command !== GREETING_HOOK) {
    return EXIT.ok;
  }
  const answering = { ...runtime, host: error.ports };
  const { event } = await readHookInput(answering);
  if (event?.name === 'session-start') {
    const notice = unlistedHostNotice(error);
    writeReply(answering, 'session-start', { notice, context: notice });
  }
  return EXIT.ok;
}
