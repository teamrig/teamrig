import { formatConfig } from '../config/load.ts';
import type { Files } from '../core/files.ts';
import { errorMessage, isRecord } from '../core/guards.ts';
import { RefusedError } from './runtime.ts';

/**
 * The record of the allow rules `automode install` wrote into each host settings file (T5120, security verdict T5156
 * S4-2), kept in the kit's home: a sync takes out only rules this record names, so a person's own rule is never taken
 * over or removed, even one equal to a synced rule. A missing record reads as empty; one that is not a JSON object of
 * string lists is refused before anything is written.
 */

/** Each settings file's path, and the rules a sync wrote there that it still holds. */
export type AllowRecord = ReadonlyMap<string, readonly string[]>;

/** The record, empty when there is none yet. */
export async function readAllowRecord(files: Files, path: string): Promise<AllowRecord> {
  const text = await files.read(path);
  if (text === undefined) {
    return new Map();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new RefusedError(`${path} is not valid JSON (${errorMessage(error)}); nothing written`);
  }
  if (!isRecord(raw)) {
    throw new RefusedError(`${path} is not a JSON object; nothing written`);
  }
  const record = new Map<string, readonly string[]>();
  for (const [settingsPath, rules] of Object.entries(raw)) {
    if (!isStringList(rules)) {
      throw new RefusedError(`${path}: ${settingsPath} is not a list of strings; nothing written`);
    }
    record.set(settingsPath, rules);
  }
  return record;
}

/** The record with one settings file's rules replaced; a file left with none drops out. */
export function withOwned(record: AllowRecord, settingsPath: string, rules: readonly string[]): AllowRecord {
  const next = new Map(record);
  if (rules.length === 0) {
    next.delete(settingsPath);
  } else {
    next.set(settingsPath, [...new Set(rules)]);
  }
  return next;
}

/** True when both records name the same rules, in the same order, for the same files. */
export function sameRecord(left: AllowRecord, right: AllowRecord): boolean {
  return left.size === right.size && [...left].every(([path, rules]) => {
    const other = right.get(path);
    return other !== undefined && other.length === rules.length && other.every((rule, index) => rule === rules[index]);
  });
}

/** Replaces the record atomically. */
export async function writeAllowRecord(files: Files, path: string, record: AllowRecord): Promise<void> {
  await files.write(path, formatConfig(Object.fromEntries(record)));
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
