import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { stringField } from '../core/guards.ts';
import { parseObject, toJsonlLine, VERSION_FIELD } from '../core/jsonl.ts';

/** The format of the last-typed file; a file in another format reads as no record. */
export const LAST_TYPED_FORMAT = 1;

/** The session a person last typed a prompt in, in any team on this host (T5101). */
export interface LastTyped {
  readonly team: string;
  /** The team session's id. */
  readonly session: string;
  /** The AI CLI session of the tab typed in, so a UI can tell two tabs of one session apart. */
  readonly tab: string;
  /** When the prompt was sent, an ISO time. */
  readonly at: string;
}

/** The host's last-typed file, under the teamrig home: one for every team, as a UI follows the person across them. */
export function lastTypedPath(kitHome: string): string {
  return join(kitHome, 'last-typed.json');
}

/** The file's record; undefined when it is damaged or from another format. */
export function parseLastTyped(text: string): LastTyped | undefined {
  const record = parseObject(text.trim());
  if (record === undefined || record[VERSION_FIELD] !== LAST_TYPED_FORMAT) {
    return undefined;
  }
  const team = stringField(record, 'team');
  const session = stringField(record, 'session');
  const tab = stringField(record, 'tab');
  const at = stringField(record, 'at');
  return team === undefined || session === undefined || tab === undefined || at === undefined ? undefined : { team, session, tab, at };
}

export function formatLastTyped(typed: LastTyped): string {
  return toJsonlLine({ [VERSION_FIELD]: LAST_TYPED_FORMAT, team: typed.team, session: typed.session, tab: typed.tab, at: typed.at });
}

/**
 * Where the person last typed, kept for a UI to follow (T5101): the prompt hook writes it for each prompt the person
 * sent, never for one teamrig submitted to wake a tab, so a wake never pulls the view away from where the person
 * works. One small file replaced whole, atomically, so a reader never sees half a record; the last write wins.
 */
export class LastTypedStore {
  private readonly files: Files;
  private readonly path: string;

  constructor(files: Files, kitHome: string) {
    this.files = files;
    this.path = lastTypedPath(kitHome);
  }

  async read(): Promise<LastTyped | undefined> {
    const text = await this.files.read(this.path);
    return text === undefined ? undefined : parseLastTyped(text);
  }

  async write(typed: LastTyped): Promise<void> {
    await this.files.write(this.path, formatLastTyped(typed));
  }
}
