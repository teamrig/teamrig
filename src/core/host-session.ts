import type { JsonRecord } from './guards.ts';

/**
 * The field a stored record names its host session by: the session of the host a team session's tab runs in, a
 * Claude Code session id today. Records written before the rename name it `claudeSession`, and three stores `claude`.
 * Every reader takes both names, so a store's writer moves to this one only a release after its readers did: a tab
 * keeps the teamrig it loaded until it reloads, and old and new code share the stores meanwhile.
 */
export const HOST_SESSION_FIELD = 'hostSession';

/**
 * A host session id as the shared stores take it, whichever host gave it: a letter or digit, then letters, digits, `_`
 * or `-`, at most 128 in all. Each host adapter checks its own id shape where it reads the host's input (a Claude Code
 * or Codex id is a UUID); the stores hold the ids of every host a team runs, so they check only what keeps an id safe
 * where it goes: a file name (no dot, slash or device name) and an argument (no leading `-`).
 */
const HOST_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Names Windows keeps for devices in every folder, whatever the extension: `nul.json` is no file there. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Whether `value` is a host session id the stores take: see {@link HOST_SESSION_ID}. */
export function isHostSessionId(value: string): boolean {
  return HOST_SESSION_ID.test(value) && !DEVICE_NAME.test(value);
}

/** The field a store's records named the host session by before `HOST_SESSION_FIELD`. */
export type LegacyHostSessionField = 'claudeSession' | 'claude';

/**
 * The record's host session as stored, unchecked: `HOST_SESSION_FIELD` when the record has it, null included, else
 * the store's old field. A reader that keeps a null or checks the id's shape starts here.
 */
export function hostSessionValue(record: JsonRecord, legacy: LegacyHostSessionField): unknown {
  return Object.hasOwn(record, HOST_SESSION_FIELD) ? record[HOST_SESSION_FIELD] : record[legacy];
}

/**
 * The record as its store writes it today: a `HOST_SESSION_FIELD` key renamed to the store's old field in the same
 * place, so the code's name moves no stored byte and an older tab still reads the line. A store's next format drops
 * this call.
 */
export function legacyHostSessionRecord(record: JsonRecord, legacy: LegacyHostSessionField): JsonRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key === HOST_SESSION_FIELD ? legacy : key, value]));
}

/** The record's host session; undefined when it names none, or names it by anything but text. */
export function hostSessionOf(record: JsonRecord, legacy: LegacyHostSessionField): string | undefined {
  const value = hostSessionValue(record, legacy);
  return typeof value === 'string' ? value : undefined;
}
