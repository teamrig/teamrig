import { snapshotOfTranscript } from '../../budget/snapshot.ts';
import type { HookEvent } from '../../ports/host/index.ts';
import { usageIfMetered } from '../host.ts';
import type { CliRuntime } from '../runtime.ts';
import { saveSnapshot, snapshotDirAt } from './snapshot-save.ts';

/**
 * How much of a transcript's end a turn end reads for the plan's windows: Codex writes a token_count after each model
 * call, so the last one sits in the turn's final lines, well inside this even after a long tool output.
 */
export const WEEK_TAIL_BYTES = 128 * 1024;

/**
 * At a turn's end in a host whose transcript tells the plan's windows (`UsageMeter.transcriptWeekReading`, Codex CLI's
 * rollouts), saves the newest reading as the session's snapshot, as `statusline` does for a host that hands its status
 * line one: `budget` and the pace line then read the week of a session with no status line. A host whose meter has
 * no such reading (Claude Code, whose status line saves it) reads nothing here. A transcript with no reading in its
 * tail, or a session id not shaped as one, saves nothing; a failed write throws, for the caller to tell on stderr.
 */
export async function turnEndWeekReading(runtime: CliRuntime, event: HookEvent): Promise<void> {
  const read = usageIfMetered(runtime)?.transcriptWeekReading;
  if (read === undefined || event.transcript === undefined || event.session === undefined) {
    return;
  }
  const tail = await runtime.files.readTail(event.transcript, WEEK_TAIL_BYTES);
  const reading = tail === undefined ? undefined : read(tail);
  if (reading === undefined) {
    return;
  }
  const cwd = event.cwd ?? runtime.cwd;
  const snapshot = snapshotOfTranscript({ sessionId: event.session, cwd, model: event.model, effort: event.effort }, reading, runtime.clock.now());
  if (snapshot === undefined) {
    return;
  }
  await saveSnapshot(runtime, await snapshotDirAt(runtime, cwd), snapshot, 'teamrig hook stop');
}
