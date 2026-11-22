import { existsSync, readFileSync } from 'node:fs';
import { isRecord, recordField } from './guards.ts';

/**
 * A count baseline: the recorded count of each key (a skill, a rule) that a check holds a count to, so the count can
 * fall but never rise. The file is `{ "$comment": <what it holds>, <field>: { <key>: <whole count> } }`.
 */

/** What one count did against its baseline. A key the baseline lacks has a baseline of 0. */
export interface CountChange {
  readonly key: string;
  readonly count: number;
  readonly baseline: number;
}

export interface Comparison {
  /** Counts above their baseline: the check fails on each. */
  readonly rose: readonly CountChange[];
  /** Counts below their baseline: `--write` lowers it. */
  readonly fell: readonly CountChange[];
  /** Baseline entries of keys no longer counted. */
  readonly gone: readonly string[];
}

export function compareCounts(counts: ReadonlyMap<string, number>, baseline: ReadonlyMap<string, number>): Comparison {
  const changes = [...counts].map(([key, count]) => ({ key, count, baseline: baseline.get(key) ?? 0 }));
  return {
    rose: changes.filter((change) => change.count > change.baseline),
    fell: changes.filter((change) => change.count < change.baseline),
    gone: [...baseline.keys()].filter((key) => !counts.has(key)).sort(),
  };
}

/** The counts under `field` of a parsed baseline file; throws on anything but `{ <field>: { <key>: <whole count> } }`. */
export function parseBaseline(value: unknown, field: string): ReadonlyMap<string, number> {
  const entries = isRecord(value) ? recordField(value, field) : undefined;
  if (entries === undefined) throw new Error(`the baseline needs a "${field}" object`);
  return new Map(
    Object.entries(entries).map(([key, count]) => {
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error(`the baseline count of ${key} is not a whole number`);
      return [key, count];
    }),
  );
}

/** The baseline file's text for these counts, keys sorted, so each OS writes the same bytes. */
export function baselineText(comment: string, field: string, counts: ReadonlyMap<string, number>): string {
  const entries = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ $comment: comment, [field]: entries }, null, 2)}\n`;
}

/** The counts under `field` of the baseline file at `path`, none when there is no file yet. */
export function readBaseline(path: string, field: string): ReadonlyMap<string, number> {
  return existsSync(path) ? parseBaseline(JSON.parse(readFileSync(path, 'utf8')), field) : new Map();
}
