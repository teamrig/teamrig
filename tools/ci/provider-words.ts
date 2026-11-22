/**
 * The provider-word check of the skills (docs/design/provider-neutral-skills.md): how often a skill names one host's
 * or tool's own words, counted so the count can only fall. A skill tells the step (open a pull request, refresh the
 * context); the adapter that serves the host or tool says how. Each adapter's declaration names its product's terms,
 * so a new adapter's words are counted from the day it ships.
 */

import type { Declarations } from '../../src/composition/loader.ts';

/** One file of a skill: the skill's folder and the file's path, both from the repo root with `/`, and its text. */
export interface SkillFile {
  readonly skill: string;
  readonly path: string;
  readonly text: string;
}

/**
 * The terms the check counts: each declaration's own words in the order given, a word two adapters both name kept once
 * (case-blind, as it matches), so one word in a skill is never counted twice.
 */
export function termList(declared: readonly (readonly string[])[]): readonly string[] {
  const seen = new Set<string>();
  return declared.flat().filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The words every adapter declares, hosts then connectors then terminals. A declaration the loader refused stops the
 * check: counting without its words would read as a fall.
 */
export function declaredTerms({ hosts, connectors, terminals }: Declarations): readonly string[] {
  const loads = [...hosts, ...connectors, ...terminals];
  const refused = loads.flatMap((load) => (load.kind === 'refused' ? [`${load.id} (${load.notices.join('; ')})`] : []));
  if (refused.length > 0) throw new Error(`cannot read the terms of ${refused.join(', ')}`);
  return termList(loads.flatMap((load) => (load.kind === 'loaded' ? [load.value.terms ?? []] : [])));
}

export interface ProviderHit {
  readonly skill: string;
  readonly path: string;
  /** From 1. */
  readonly line: number;
  /** The term as the list spells it, not as the line does. */
  readonly term: string;
}

const WORD_CHAR = /\w/;

/** A term's pattern: case-blind, with a word bound at each edge that is a word character. */
export function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const start = WORD_CHAR.test(term.charAt(0)) ? '\\b' : '';
  const end = WORD_CHAR.test(term.charAt(term.length - 1)) ? '\\b' : '';
  return new RegExp(`${start}${escaped}${end}`, 'gi');
}

/** Every term a file names, one hit per match, by line and then in the terms' order. */
export function providerHits(files: readonly SkillFile[], terms: readonly string[]): readonly ProviderHit[] {
  const patterns = terms.map((term) => ({ term, pattern: termPattern(term) }));
  return files.flatMap((file) =>
    file.text.split('\n').flatMap((text, index) => patterns.flatMap(({ term, pattern }) => [...text.matchAll(pattern)].map(() => ({ skill: file.skill, path: file.path, line: index + 1, term })))),
  );
}

/** How many hits each skill has, every skill of the files listed (a skill with none at 0), sorted by its folder. */
export function skillCounts(files: readonly SkillFile[], terms: readonly string[]): ReadonlyMap<string, number> {
  const hits = providerHits(files, terms);
  const skills = [...new Set(files.map((file) => file.skill))].sort();
  return new Map(skills.map((skill) => [skill, hits.filter((hit) => hit.skill === skill).length]));
}

/** The baseline file of the check, the field that holds its counts and the comment it opens with. */
export const BASELINE_FILE = {
  field: 'skills',
  comment:
    'The provider-word check (tools/ci/provider-words-cli.ts): how many host or tool words each skill names. A count may fall, never rise; `--write` records the counts and refuses a rise.',
} as const;

export function hitLine(hit: ProviderHit): string {
  return `${hit.path}:${hit.line}: ${hit.term}`;
}
