import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_SET_HOOK } from '../../src/cli/guard-runner.ts';
import { isRecord, isStringArray, recordField, type JsonRecord } from '../../src/core/guards.ts';

/**
 * The docs' count of teamrig's Claude Code hooks, held to the plugin's hooks.json: a hand-kept number went stale twice
 * (fifteen, then twenty-four, while hooks.json grew to more), and the overview pages still said four. A hook counts
 * once however many events it runs on, so the count is the distinct `hook <name>` commands hooks.json runs, and the
 * guide's hooks page has one table row for each of them.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HOOKS_JSON = 'plugins/teamrig/hooks/hooks.json';
const HOOKS_PAGE = 'plugins/teamrig/skills/teamrig-guide/hooks.md';
const DOC_DIRS = ['docs', 'docs/guides', 'plugins/teamrig/skills/teamrig-guide'] as const;
/** The table rows for the plugin's mod, whose hooks register.ts runs, not hooks.json. */
const MOD_ROW = '| The mod';
const HOOK_CELL = /`hook ([a-z-]+)`/g;
const COUNTED = /\b([a-z]+(?:-[a-z]+)?) Claude Code hooks\b/g;

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** A whole number under 100 in words, as the docs write it: `twenty-six`. */
function numberWord(value: number): string {
  const ones = ONES[value % 10] ?? '';
  if (value < ONES.length) return ONES[value] ?? '';
  const tens = TENS[Math.floor(value / 10)] ?? '';
  return value % 10 === 0 ? tens : `${tens}-${ones}`;
}

const NUMBER_WORDS: ReadonlySet<string> = new Set(Array.from({ length: 99 }, (_, index) => numberWord(index + 1)));

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * The hooks one command runs: the name after `hook`, or for `hook guards <name> ...` each guard it names (T5553), since
 * a set is one process for several hooks, not a hook of its own.
 */
function hookNamesOf(args: readonly string[]): readonly string[] {
  const after = args.slice(args.indexOf('hook') + 1);
  const [name, ...rest] = after;
  if (name !== GUARD_SET_HOOK) {
    return name === undefined ? [] : [name];
  }
  const end = rest.findIndex((word) => word.startsWith('--'));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The hooks the commands hooks.json runs run, once each, sorted. */
function hooksJsonNames(): string[] {
  const parsed: unknown = JSON.parse(read(HOOKS_JSON));
  const events = isRecord(parsed) ? recordField(parsed, 'hooks') : undefined;
  assert.ok(events !== undefined, `${HOOKS_JSON} has a hooks object`);
  const names = new Set<string>();
  for (const group of Object.values(events).flatMap(records)) {
    for (const hook of records(group['hooks'])) {
      const args = hook['args'];
      if (isStringArray(args) && args.includes('hook')) hookNamesOf(args).forEach((name) => names.add(name));
    }
  }
  return [...names].sort();
}

/** The hook names the hooks page's first table gives Claude Code events, the mod's rows left out, once each, sorted. */
function hooksPageNames(): string[] {
  const intro = read(HOOKS_PAGE).split(/\r?\n## /)[0] ?? '';
  const names = new Set<string>();
  for (const row of intro.split(/\r?\n/)) {
    const hooks = row.split(' | ')[1];
    if (!row.startsWith('| ') || row.startsWith(MOD_ROW) || hooks === undefined) continue;
    for (const match of hooks.matchAll(HOOK_CELL)) if (match[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

/** Each `<number word> Claude Code hooks` the docs write, with its page, line breaks read as spaces. */
function countsInDocs(): { readonly path: string; readonly word: string }[] {
  const pages = ['README.md', ...DOC_DIRS.flatMap((dir) => readdirSync(join(ROOT, dir)).filter((name) => name.endsWith('.md')).map((name) => `${dir}/${name}`))];
  return pages.flatMap((path) =>
    [...read(path).replace(/\s*\r?\n\s*/g, ' ').matchAll(COUNTED)]
      .map((match) => match[1] ?? '')
      .filter((word) => NUMBER_WORDS.has(word))
      .map((word) => ({ path, word })),
  );
}

describe("the docs' count of teamrig's hooks", () => {
  const names = hooksJsonNames();

  it('reads the hooks hooks.json runs', () => {
    assert.ok(names.length > 1, `${HOOKS_JSON} runs hooks`);
    assert.ok(names.includes('session-start'), `${HOOKS_JSON} runs hook session-start`);
  });

  it('gives each hook hooks.json runs one row of the hooks page, and no other hook a row', () => {
    assert.deepEqual(hooksPageNames(), names);
  });

  it('is the number of hooks hooks.json runs, on every page that counts them', () => {
    const counts = countsInDocs();
    assert.ok(counts.some((count) => count.path === HOOKS_PAGE), `${HOOKS_PAGE} counts the hooks`);
    assert.deepEqual(
      counts.filter((count) => count.word !== numberWord(names.length)),
      [],
      `every count says ${numberWord(names.length)}`,
    );
  });

  it('writes numbers in words', () => {
    assert.deepEqual([1, 9, 15, 20, 24, 26, 99].map(numberWord), ['one', 'nine', 'fifteen', 'twenty', 'twenty-four', 'twenty-six', 'ninety-nine']);
  });
});
