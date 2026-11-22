import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitSyncIn } from './git.ts';
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

/** Runs git in a repo and returns its stdout; throws when git fails. `gitSyncIn` makes one. */
export type GitRunner = (args: readonly string[]) => string;

/**
 * The counts under `field` of the baseline file at `path` (a `/` path from the repo root) as commit `rev` holds it,
 * none when that commit has no such file. Throws when `rev` names no commit: a base commit CI failed to fetch fails
 * the check rather than holding the counts to nothing.
 */
export function baselineAt(git: GitRunner, rev: string, path: string, field: string): ReadonlyMap<string, number> {
  try {
    git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  } catch (error) {
    throw new Error(`--base ${rev} names no commit in this repo`, { cause: error });
  }
  if (git(['ls-tree', '--name-only', rev, '--', path]).trim() === '') return new Map();
  return parseBaseline(JSON.parse(git(['show', `${rev}:${path}`])), field);
}

/**
 * The baseline a pull request's counts are held to: each key at the lower of the pull request's own baseline and the
 * base commit's, so a change cannot raise a count by raising its own baseline file in the same change (a raise needs
 * a change of its own, reviewed as one). A key only one side has keeps that side's count: a new rule or skill is
 * recorded by its own change, and a key the pull request dropped is still held to the base's.
 */
export function heldBaseline(own: ReadonlyMap<string, number>, base: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const held = new Map(base);
  for (const [key, count] of own) held.set(key, Math.min(count, base.get(key) ?? count));
  return held;
}

/** A check's arguments with `--base <rev>` taken out. */
export interface BasedArgs {
  /** The commit whose baseline file also holds the counts, when given. */
  readonly base: string | undefined;
  /** The other arguments, in their order. */
  readonly rest: readonly string[];
}

/** Takes `--base <rev>` out of a check's arguments; throws when the rev is missing or `--base` is given twice. */
export function takeBase(args: readonly string[]): BasedArgs {
  const at = args.indexOf('--base');
  if (at === -1) return { base: undefined, rest: args };
  const rev = args[at + 1];
  if (rev === undefined || rev.startsWith('-')) throw new Error('--base needs a commit');
  const rest = [...args.slice(0, at), ...args.slice(at + 2)];
  if (rest.includes('--base')) throw new Error('--base is given twice');
  return { base: rev, rest };
}

/**
 * The counts a check holds the repo at `root` to: its baseline file at `path`, each count lowered to the file's copy
 * at commit `base` when one is given (see `heldBaseline`).
 */
export function baselineFor(root: string, path: string, field: string, base: string | undefined, git: GitRunner = gitSyncIn(root)): ReadonlyMap<string, number> {
  const own = readBaseline(join(root, path), field);
  return base === undefined ? own : heldBaseline(own, baselineAt(git, base, path, field));
}
