import type { ProgramResult, SessionWake, WakeDelivery } from '../../../plugin-api/index.ts';

/**
 * What `codex queue` prints when no running session has the thread (Codex `cli/src/queue_cmd.rs`, read 11-25): the
 * session ended, so a wake waits for its next start.
 */
const NO_SESSION = /No active session found matching/;

/** A wake Codex CLI would read as something else, refused before the program runs. */
export class CodexWakeRefusedError extends Error {
  override readonly name = 'CodexWakeRefusedError';
}

/**
 * The `codex queue` arguments that hand thread `session` the prompt `text` as its next turn: Codex sends it to the
 * shared local app-server daemon the session runs on (`thread/queue/add`). Each value is joined to its flag with `=`,
 * so an id or a prompt starting with `-` stays a value and is never read as a flag. Codex refuses an empty message,
 * so teamrig refuses one first, with its own words.
 */
export function wakeArgs(session: string, text: string): readonly string[] {
  if (session.trim() === '') {
    throw new CodexWakeRefusedError('the Codex CLI thread to wake is blank; give the id the session told');
  }
  if (text.trim() === '') {
    throw new CodexWakeRefusedError('the wake prompt is blank; Codex CLI queues no empty message');
  }
  return ['queue', `--thread=${session}`, `--message=${text}`];
}

/** The first line of output that holds anything, trimmed: what a refusal says. */
function firstLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '');
}

/**
 * What a `codex queue` run's end says. Codex exits 0 once the daemon has queued the message ("Queued message <id> for
 * thread <thread>."); any other end is a refusal, told apart only when it says the thread runs nowhere.
 */
export function wakeOutcome(result: ProgramResult): WakeDelivery {
  if (result.end.kind === 'exited' && result.end.code === 0) {
    return { kind: 'delivered' };
  }
  if (NO_SESSION.test(result.stderr) || NO_SESSION.test(result.stdout)) {
    return { kind: 'no-session' };
  }
  const end = result.end.kind === 'exited' ? `exited ${result.end.code}` : `was stopped by ${result.end.signal}`;
  const said = firstLine(result.stderr) ?? firstLine(result.stdout);
  return { kind: 'failed', reason: said === undefined ? `codex queue ${end}` : `codex queue ${end}: ${said}` };
}

/** Codex CLI's wake: `codex queue` through the daemon its sessions share. */
export const CODEX_WAKE: SessionWake = { args: wakeArgs, outcome: wakeOutcome };
