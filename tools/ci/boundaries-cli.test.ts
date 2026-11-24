import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineText, parseBaseline } from '../lib/count-baseline.ts';
import { TOOLS_REPO } from '../lib/repo-root.ts';
import { type CliRun, TempRepo } from '../lib/temp-repo.ts';
import { BASELINE_FILE, BOUNDARY_RULES } from './boundaries.ts';

const CLI = fileURLToPath(new URL('./boundaries-cli.ts', import.meta.url));
const BASELINE = 'tools/ci/boundaries.json';
const HELD = 'boundaries: a count may fall, never rise\n';
/** Each rule's count line, given the counts in the rules' order. */
const counted = (...counts: readonly number[]): string => BOUNDARY_RULES.map((rule, index) => `boundaries: ${counts[index] ?? 0} ${rule.title}\n`).join('');
/** The counts of the repo `crossed` writes, by rule. */
const CROSSED: readonly (readonly [string, number])[] = [
  ['core-imports', 1],
  ['adapter-reach', 2],
  ['adapter-imports', 1],
  ['fakes-reach', 1],
  ['tool-names', 2],
];

describe('boundaries-cli', () => {
  let repo: TempRepo;
  /** Runs the CLI on the temp repo from a folder outside it, so a read by the cwd would find nothing. */
  const check = (args: readonly string[] = []): CliRun => repo.runOutside(CLI, [...args, '--root', repo.dir]);
  const baseline = (entries: readonly (readonly [string, number])[]): void => {
    repo.write(BASELINE, baselineText(BASELINE_FILE.comment, BASELINE_FILE.field, new Map(entries)));
  };
  const written = (): ReadonlyMap<string, number> => parseBaseline(JSON.parse(readFileSync(join(repo.dir, BASELINE), 'utf8')), BASELINE_FILE.field);
  /** A repo with a finding of every rule, and files the check must not read. */
  const crossed = (): void => {
    repo.write('tools/docs/pages/draw.ts', "import host from '../../../src/adapters/hosts/first/index.ts';\n");
    repo.write('src/core/run.ts', "import { b } from '../cli/b.ts';\n");
    repo.write('src/cli/b.ts', "import host from '../adapters/hosts/first/index.ts';\nexport const codexHome = host;\nexport const jiraKey = 1;\n");
    repo.write('src/cli/c.ts', "import { FakeTool } from '../testing/fake-tool.ts';\n");
    repo.write('src/adapters/hosts/first/index.ts', "import { isRecord } from '../../../core/guards.ts';\n");
    repo.write('src/cli/notes.md', 'codex\n');
    repo.write('docs/draw.ts', "import host from '../src/adapters/hosts/first/index.ts';\n");
  };
  beforeEach(() => {
    repo = new TempRepo('boundaries');
  });
  afterEach(() => repo.remove());

  it('passes counts at their baseline, counting each rule over the .ts files of src and tools of the --root repo', () => {
    crossed();
    baseline(CROSSED);
    const result = check();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${counted(1, 2, 1, 1, 2)}${HELD}`);
  });

  it('fails a count above its baseline, and any finding of a rule the baseline lacks', () => {
    crossed();
    baseline([['core-imports', 1], ['adapter-reach', 1], ['adapter-imports', 1], ['tool-names', 2]]);
    const result = check();
    assert.equal(result.status, 1, result.stderr);
    const rose = ['adapter-reach rose to 2 from 1', 'fakes-reach rose to 1 from 0'].map((line) => `boundaries: ${line}: run --list to see each finding\n`);
    assert.equal(result.stdout, `${counted(1, 2, 1, 1, 2)}${rose.join('')}${HELD}`);
  });

  it('fails every finding when there is no baseline file', () => {
    crossed();
    const result = check();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /boundaries: tool-names rose to 2 from 0/);
  });

  it('passes a fall and a gone rule, naming --write for each', () => {
    crossed();
    baseline([...CROSSED.filter(([rule]) => rule !== 'tool-names'), ['tool-names', 5], ['old-rule', 3]]);
    const result = check();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${counted(1, 2, 1, 1, 2)}boundaries: tool-names fell to 2 from 5: run --write to lower its baseline\nboundaries: old-rule is gone: run --write to drop its baseline\n${HELD}`);
  });

  it('--list prints each finding before the counts, src before tools, each sorted by its / path', () => {
    crossed();
    baseline(CROSSED);
    const result = check(['--list']);
    assert.equal(result.status, 0, result.stderr);
    const findings = [
      'src/adapters/hosts/first/index.ts:1: adapter-imports: src/core/guards.ts',
      'src/cli/b.ts:1: adapter-reach: src/adapters/hosts/first/index.ts',
      'src/cli/b.ts:2: tool-names: codex',
      'src/cli/b.ts:3: tool-names: jira',
      'src/cli/c.ts:1: fakes-reach: src/testing/fake-tool.ts',
      'src/core/run.ts:1: core-imports: src/cli/b.ts',
      'tools/docs/pages/draw.ts:1: adapter-reach: src/adapters/hosts/first/index.ts',
    ];
    assert.equal(result.stdout, `${findings.join('\n')}\n${counted(1, 2, 1, 1, 2)}${HELD}`);
  });

  it('--write records falls and new rules, and drops gone ones', () => {
    crossed();
    baseline([['tool-names', 5], ['old-rule', 3]]);
    const result = check(['--write']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /boundaries: wrote tools\/ci\/boundaries\.json\n$/);
    assert.deepEqual([...written()], [...CROSSED].sort(([a], [b]) => (a < b ? -1 : 1)));
  });

  it('--write refuses a rise over a recorded baseline and writes nothing', () => {
    crossed();
    baseline([['tool-names', 1]]);
    const result = check(['--write']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /boundaries: tool-names rose to 2 from 1: run --list to see each finding\nboundaries: wrote nothing: a count never rises\n$/);
    assert.deepEqual([...written()], [['tool-names', 1]]);
  });

  it('counts nothing and passes in a repo with no src or tools folder and no baseline', () => {
    const result = check(['--list']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${counted(0, 0, 0, 0, 0)}${HELD}`);
  });

  it('checks its own repo, which its baseline holds, when no --root is given, and writes nothing in the cwd', () => {
    const own = repo.runOutside(CLI);
    assert.equal(own.stderr, '');
    assert.equal(own.status, 0, own.stdout);
    assert.deepEqual(own, repo.runOutside(CLI, ['--root', TOOLS_REPO]));
    assert.deepEqual(readdirSync(repo.outside), []);
  });

  it('exits 2 on an unknown option, a --root with no folder or a broken baseline', () => {
    const unknown = check(['--fix']);
    assert.equal(unknown.status, 2);
    assert.equal(unknown.stderr, 'boundaries: unknown option --fix (usage: boundaries-cli.ts [--list] [--write] [--base <commit>] [--root <repo>])\n');
    const bare = repo.runOutside(CLI, ['--root']);
    assert.equal(bare.status, 2);
    assert.equal(bare.stderr, 'boundaries: --root needs a folder\n');
    repo.write(BASELINE, '{"rules": {"tool-names": -1}}');
    const broken = check();
    assert.equal(broken.status, 2);
    assert.equal(broken.stderr, 'boundaries: the baseline count of tool-names is not a whole number\n');
  });

  describe('--base', () => {
    /** Commits the crossed repo at its own counts, as the base branch holds it. */
    const based = (): void => {
      crossed();
      baseline(CROSSED);
      repo.init();
      repo.git('add', '-A');
      repo.git('commit', '-q', '-m', 'base');
    };
    /** The crossed counts with tool-names at `count`. */
    const withToolNames = (count: number): readonly (readonly [string, number])[] => CROSSED.map(([key, was]) => [key, key === 'tool-names' ? count : was]);

    it("fails a rise the change records in its own baseline, which the base commit's copy does not hold", () => {
      based();
      repo.write('src/cli/d.ts', 'export const jiraBoard = 1;\n');
      baseline(withToolNames(3));
      assert.equal(check().status, 0, 'without --base the raised baseline passes');
      const held = check(['--base', 'HEAD']);
      assert.equal(held.status, 1, held.stderr);
      assert.equal(
        held.stdout,
        `${counted(1, 2, 1, 1, 3)}boundaries: each count held to the lower of ${BASELINE} and its copy at HEAD\nboundaries: tool-names rose to 3 from 2: run --list to see each finding\n${HELD}`,
      );
    });

    it("holds a count to the change's own baseline where it is the lower", () => {
      based();
      repo.write('src/cli/b.ts', "import host from '../adapters/hosts/first/index.ts';\nexport const jiraKey = host;\n");
      baseline(withToolNames(1));
      assert.equal(check(['--base', 'HEAD']).status, 0);
      repo.write('src/cli/d.ts', 'export const jiraBoard = 1;\n');
      const rose = check(['--base', 'HEAD']);
      assert.equal(rose.status, 1, rose.stderr);
      assert.match(rose.stdout, /boundaries: tool-names rose to 2 from 1: run --list/);
    });

    it('holds the counts to the change alone when the base commit has no baseline file', () => {
      repo.init();
      repo.write('README.md', 'base\n');
      repo.git('add', '-A');
      repo.git('commit', '-q', '-m', 'base');
      crossed();
      baseline(CROSSED);
      const result = check(['--base', 'HEAD']);
      assert.equal(result.status, 0, result.stdout);
    });

    it('exits 2 on a --base with no commit, one naming no commit, or one beside --write', () => {
      based();
      const bare = check(['--base']);
      assert.equal(bare.status, 2);
      assert.equal(bare.stderr, 'boundaries: --base needs a commit\n');
      const missing = check(['--base', 'no-such-branch']);
      assert.equal(missing.status, 2);
      assert.equal(missing.stderr, 'boundaries: --base no-such-branch names no commit in this repo\n');
      const writing = check(['--base', 'HEAD', '--write']);
      assert.equal(writing.status, 2);
      assert.match(writing.stderr, /^boundaries: --base holds a check, --write records counts: give one/);
    });
  });
});
