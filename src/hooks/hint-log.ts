import { stringField } from '../core/guards.ts';
import { hostSessionOf } from '../core/host-session.ts';
import { parseJsonl, toJsonlLine } from '../core/jsonl.ts';
import type { LogFile } from '../core/log-file.ts';

export const HINT_VERSION = 1;

/**
 * The hints the hooks already gave, so each is given once per Claude Code session: the prompt hook's
 * bind hints (once for a tab with no title, once more for each title that binds nothing), the
 * session start's note of missing requirements, and the turn end's line of each restriction the session runs
 * under (hook-restriction.ts).
 */
export interface HintLog {
  shown(hostSession: string, reason: string): Promise<boolean>;
  record(hostSession: string, reason: string, at: Date): Promise<void>;
}

/**
 * `bind-hints.jsonl`: one `{"v":1,"claudeSession":"…","reason":"…","at":"…"}` line per hint given. A later
 * teamrig's line names the tab `hostSession`, and its hint counts here too: both share the log until every tab
 * has reloaded.
 */
export class JsonlHintLog implements HintLog {
  private readonly log: LogFile;

  constructor(log: LogFile) {
    this.log = log;
  }

  /** A line of any version naming the session and reason counts: a newer teamrig gave that hint too. */
  async shown(hostSession: string, reason: string): Promise<boolean> {
    const { records } = parseJsonl((await this.log.read()) ?? '');
    return records.some((line) => hostSessionOf(line.record, 'claudeSession') === hostSession && stringField(line.record, 'reason') === reason);
  }

  async record(hostSession: string, reason: string, at: Date): Promise<void> {
    await this.log.append(toJsonlLine({ v: HINT_VERSION, claudeSession: hostSession, reason, at: at.toISOString() }));
  }
}

/**
 * Whether the hint prints now: the first time for this Claude Code session and reason, recorded
 * before it prints. A log that cannot be read or written never silences the hint: it prints again.
 */
export async function firstHint(log: HintLog, hostSession: string, reason: string, now: Date): Promise<boolean> {
  try {
    if (await log.shown(hostSession, reason)) {
      return false;
    }
    await log.record(hostSession, reason, now);
  } catch {
    // The hint is one short line: shown again beats never shown.
  }
  return true;
}
