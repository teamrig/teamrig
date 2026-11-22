/**
 * The provider-word check of the skills (docs/design/provider-neutral-skills.md): how often a skill names one host's
 * or tool's own words, counted so the count can only fall. A skill tells the step (open a pull request, refresh the
 * context); the adapter that serves the host or tool says how. The terms live here until the declarations carry them
 * (stopgap T4860 slice 3).
 */

/** One file of a skill: the skill's folder and the file's path, both from the repo root with `/`, and its text. */
export interface SkillFile {
  readonly skill: string;
  readonly path: string;
  readonly text: string;
}

/** Each provider's own words. A term matches whole words at its word-character edges, so `gh` never hits `high`. */
export const PROVIDER_TERMS = [
  { provider: 'GitHub', terms: ['GitHub', 'gh', 'pull request'] },
  { provider: 'Claude Code', terms: ['Claude Code', 'CLAUDE.md', '.claude/', '/clear'] },
  { provider: 'Jira', terms: ['Jira', 'JQL'] },
] as const;

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

const PATTERNS: readonly { readonly term: string; readonly pattern: RegExp }[] = PROVIDER_TERMS.flatMap(({ terms }) => terms.map((term) => ({ term, pattern: termPattern(term) })));

/** Every term a file names, one hit per match, by line and then in the terms' order. */
export function providerHits(files: readonly SkillFile[]): readonly ProviderHit[] {
  return files.flatMap((file) =>
    file.text.split('\n').flatMap((text, index) => PATTERNS.flatMap(({ term, pattern }) => [...text.matchAll(pattern)].map(() => ({ skill: file.skill, path: file.path, line: index + 1, term })))),
  );
}

/** How many hits each skill has, every skill of the files listed (a skill with none at 0), sorted by its folder. */
export function skillCounts(files: readonly SkillFile[]): ReadonlyMap<string, number> {
  const hits = providerHits(files);
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
