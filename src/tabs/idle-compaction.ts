import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { stringField } from '../core/guards.ts';
import type { TeamPaths } from '../core/home.ts';
import { parseObject, toJsonlLine, VERSION_FIELD } from '../core/jsonl.ts';
import type { TabState } from './state.ts';

/**
 * A compaction that starts while a session's prompt sits empty interrupts no turn, so no turn end follows it to set
 * the tab ready again (#1065). Its start leaves a note, `<team>/state/tabs/idle-compactions/<id>.json`, which its end
 * takes: the tab then ends ready, not working. One small file per session, written and removed only around a
 * compaction; the session's end removes one a compaction left.
 */

/** The format of the notes this code reads and writes; a note in another format reads as absent. */
export const IDLE_COMPACTION_FORMAT = 1;

/** The states a tab shows while its prompt sits empty: no turn runs, so a compaction then starts on an idle prompt. */
const IDLE_STATES: ReadonlySet<TabState> = new Set<TabState>(['ready', 'decision', 'error']);

/** Whether a tab in `state` sits on an empty prompt. */
export function onEmptyPrompt(state: TabState): boolean {
  return IDLE_STATES.has(state);
}

/** Whether a note's content is one this code wrote: the format and the time the compaction started. */
function isNote(text: string): boolean {
  const record = parseObject(text.trim());
  const at = record === undefined ? undefined : stringField(record, 'at');
  return record?.[VERSION_FIELD] === IDLE_COMPACTION_FORMAT && at !== undefined && !Number.isNaN(Date.parse(at));
}

/** Each session's idle-compaction note. Ids are session ids, checked by the roster, so they are safe in a path. */
export class IdleCompactionStore {
  private readonly files: Files;
  private readonly folder: string;

  constructor(files: Files, paths: Pick<TeamPaths, 'tabs'>) {
    this.files = files;
    this.folder = join(paths.tabs, 'idle-compactions');
  }

  /** Notes that a compaction of session `id` started on an empty prompt at `at`, an ISO time. */
  async note(id: string, at: string): Promise<void> {
    await this.files.write(this.pathOf(id), toJsonlLine({ [VERSION_FIELD]: IDLE_COMPACTION_FORMAT, at }));
  }

  /** Removes the session's note and says whether it held one: a damaged note or one in another format counts as none. */
  async take(id: string): Promise<boolean> {
    const text = await this.files.read(this.pathOf(id));
    if (text === undefined) {
      return false;
    }
    await this.files.remove(this.pathOf(id));
    return isNote(text);
  }

  /** Removes the session's note, as a compaction starts inside a turn or the session ends; true when there was one. */
  remove(id: string): Promise<boolean> {
    return this.files.remove(this.pathOf(id));
  }

  private pathOf(id: string): string {
    return join(this.folder, `${id}.json`);
  }
}
