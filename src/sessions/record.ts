import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { isNonNegativeInteger, stringField, type JsonRecord } from '../core/guards.ts';
import type { TeamPaths } from '../core/home.ts';
import { hostSessionOf, legacyHostSessionRecord } from '../core/host-session.ts';
import { parseObject, toJsonlLine, VERSION_FIELD } from '../core/jsonl.ts';

/** The format of the session record files this code writes; a file in a format it does not read reads as absent. */
export const SESSION_RECORD_FORMAT = 1;
/**
 * The format a later teamrig writes, naming the tab `hostSession` (T4762, src/core/host-session.ts): read from now
 * on and written by none yet, so every tab reads it before the first one writes it.
 */
export const SESSION_RECORD_NEXT_FORMAT = 2;

/**
 * Where a session last started, `<id>.json` each: its SessionStart hook records the Claude Code process its tab
 * runs in and that tab's Claude Code session at every start (a new tab, a /clear, a resume, a compaction). The
 * newest start overwrites the last, so the file names the tab the session runs in now, and once that process is
 * gone the session is closed.
 */
export interface SessionRecord {
  readonly claudePid: number;
  readonly hostSession: string;
  /** When the hook recorded it, an ISO time (a record whose time does not parse is damaged). */
  readonly at: string;
  /**
   * That Claude Code session's transcript, as the start's payload named it: it sits under the folder the tab runs
   * in, which need not be the team's project. Absent when the payload named none, and in a record written before
   * the hook kept it (the session's next start adds it).
   */
  readonly transcript?: string;
  /**
   * The shipped host adapter the session runs in (its id, as `--host` takes it), so a wake or a restore reaches the
   * session through that host's own program (T5059). Absent for a session of the default host, and in a record
   * written before the hook kept it: both read as the default host.
   */
  readonly host?: string;
}

/** A record file's content; undefined when it is damaged or from a format this code does not read. */
export function parseSessionRecord(text: string): SessionRecord | undefined {
  const record = parseObject(text.trim());
  if (record === undefined) {
    return undefined;
  }
  const format = record[VERSION_FIELD];
  if (format !== SESSION_RECORD_FORMAT && format !== SESSION_RECORD_NEXT_FORMAT) {
    return undefined;
  }
  const claudePid = record['claudePid'];
  const hostSession = hostSessionOf(record, 'claudeSession');
  const at = stringField(record, 'at');
  if (!isNonNegativeInteger(claudePid) || claudePid === 0 || hostSession === undefined || at === undefined || Number.isNaN(Date.parse(at))) {
    return undefined;
  }
  const transcript = optionalText(record, 'transcript');
  const host = optionalText(record, 'host');
  if (transcript === null || host === null) {
    return undefined;
  }
  return { claudePid, hostSession, at, ...(transcript === undefined ? {} : { transcript }), ...(host === undefined ? {} : { host }) };
}

/** An optional text field: undefined when absent, null when present but no non-empty string, which damages the record. */
function optionalText(record: JsonRecord, key: string): string | undefined | null {
  if (!(key in record)) {
    return undefined;
  }
  const value = stringField(record, key);
  return value === undefined || value === '' ? null : value;
}

export function formatSessionRecord(record: SessionRecord): string {
  return toJsonlLine(legacyHostSessionRecord({ [VERSION_FIELD]: SESSION_RECORD_FORMAT, ...record }, 'claudeSession'));
}

/** Each session's record. Ids are session ids, checked by the roster, so they are safe in a path. */
export class SessionRecordStore {
  private readonly files: Files;
  private readonly folder: string;

  constructor(files: Files, paths: Pick<TeamPaths, 'sessions'>) {
    this.files = files;
    this.folder = paths.sessions;
  }

  /** The session's record; undefined when it has none, or the file is damaged or from another format. */
  async read(id: string): Promise<SessionRecord | undefined> {
    const text = await this.files.read(this.pathOf(id));
    return text === undefined ? undefined : parseSessionRecord(text);
  }

  /** The records of `ids`, in their order: undefined for a session with none. */
  async readEach(ids: readonly string[]): Promise<Map<string, SessionRecord | undefined>> {
    return new Map(await Promise.all(ids.map(async (id): Promise<[string, SessionRecord | undefined]> => [id, await this.read(id)])));
  }

  write(id: string, record: SessionRecord): Promise<void> {
    return this.files.write(this.pathOf(id), formatSessionRecord(record));
  }

  /** The session's record file, for a reader that stamps it without reading it. */
  pathOf(id: string): string {
    return join(this.folder, `${id}.json`);
  }
}
