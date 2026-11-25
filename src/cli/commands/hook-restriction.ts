import type { TeamPaths } from '../../core/home.ts';
import { firstHint, JsonlHintLog } from '../../hooks/hint-log.ts';
import type { HookEvent, SessionRestriction } from '../../ports/host/index.ts';
import { hookLogOf } from '../hook-logs.ts';
import { launcherIfTold } from '../host.ts';
import type { CliRuntime } from '../runtime.ts';
import { WEEK_TAIL_BYTES } from './hook-turn-end-week.ts';

/**
 * How much of a transcript's end is read for the restriction: the same read as the turn end's for the plan's week.
 * A host writes the restriction as a turn starts, so a turn whose output outgrew it tells none, and the next turn
 * tells it again.
 */
export const RESTRICTION_TAIL_BYTES = WEEK_TAIL_BYTES;

const SANDBOX_WORDS: Readonly<Record<SessionRestriction['sandbox'], string>> = {
  'read-only': 'sandbox read-only',
  'workspace-write': 'sandbox workspace-write',
  none: 'no sandbox (commands write anywhere)',
  external: 'an external sandbox',
};

function networkWords(network: boolean | undefined): string | undefined {
  if (network === undefined) {
    return undefined;
  }
  return network ? 'network on' : 'network off';
}

/**
 * The restriction in one line for the human and the model. Approval `never` is said to mean no prompts alone, so it
 * is never read as the sandbox being off; teamrig only reports the host's own settings, never changing one.
 */
export function restrictionLine(restriction: SessionRestriction, command: string): string {
  const approval = restriction.approval === 'never' ? 'approval never (no prompts; the sandbox still holds)' : `approval ${restriction.approval}`;
  const profile = restriction.profile === undefined ? undefined : `profile ${restriction.profile}`;
  const parts = [approval, SANDBOX_WORDS[restriction.sandbox], networkWords(restriction.network), profile].filter((part): part is string => part !== undefined);
  return `${command}: this session runs under ${parts.join(', ')}. These are the AI CLI's own settings; ${command} changes none of them, and a step they refuse is no sign-in problem.`;
}

/** The restriction the event's transcript tells, on a host whose launcher reads one; undefined anywhere else. */
export async function restrictionOfEvent(runtime: CliRuntime, event: HookEvent): Promise<SessionRestriction | undefined> {
  const read = launcherIfTold(runtime)?.restrictionReading;
  if (read === undefined || event.transcript === undefined) {
    return undefined;
  }
  const tail = await runtime.files.readTail(event.transcript, RESTRICTION_TAIL_BYTES);
  return tail === undefined ? undefined : read(tail);
}

/**
 * The restriction line at a turn's end, for the human: once per session for each restriction, so the first turn
 * tells it and a turn under a changed one tells it again. Kept in the hooks' hint log, which a session start's notes
 * share; a log that cannot be written tells it again rather than never.
 */
export async function restrictionStopLines(runtime: CliRuntime, paths: TeamPaths, event: HookEvent, command: string): Promise<readonly string[]> {
  const restriction = await restrictionOfEvent(runtime, event);
  if (restriction === undefined || event.session === undefined) {
    return [];
  }
  const line = restrictionLine(restriction, command);
  const log = new JsonlHintLog(hookLogOf(runtime, paths, 'bind-hints'));
  return (await firstHint(log, event.session, `restriction ${line}`, new Date(runtime.clock.now()))) ? [line] : [];
}
