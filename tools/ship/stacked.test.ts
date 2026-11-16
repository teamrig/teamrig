import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stackedOn } from './stacked.ts';

const DIST = 'plugins/teamrig/dist/';

/** git answering `cherry` and `log` for the commits of base..sha: each its sha, whether main holds its patch, and its files. */
function fakeGit(commits: readonly { sha: string; landed: boolean; files: readonly string[] }[]): (...args: string[]) => string {
  return (...args: string[]): string => {
    const key = args.join(' ');
    if (key === 'cherry tip sha ba5e000') return commits.map((commit) => `${commit.landed ? '-' : '+'} ${commit.sha}`).join('\n');
    if (key === 'log --reverse --format=%x00%H %P --name-only ba5e000..sha') {
      return commits.map((commit, at) => `\0${commit.sha} ${commits[at - 1]?.sha ?? 'ba5e000'}\n\n${commit.files.join('\n')}\n`).join('');
    }
    throw new Error(`unexpected git ${key}`);
  };
}

const stacked = (commits: Parameters<typeof fakeGit>[0]): ReturnType<typeof stackedOn> => stackedOn(fakeGit(commits), [DIST], 'ba5e000', 'sha', 'tip');

test('a head main holds none of is stacked on nothing', () => {
  assert.deepEqual(stacked([{ sha: 'c1aaaaa', landed: false, files: ['src/c.ts'] }]), { kind: 'none' });
});

test("a head stacked on a landed parent starts its own work after the parent's raise and dist, which are made again", () => {
  assert.deepEqual(
    stacked([
      { sha: 'a1aaaaa', landed: true, files: ['src/a.ts'] },
      { sha: 'a2aaaaa', landed: false, files: [`${DIST}a.js`] },
      { sha: 'c1aaaaa', landed: false, files: ['src/c.ts'] },
      { sha: 'c2aaaaa', landed: false, files: [`${DIST}c.js`] },
    ]),
    { kind: 'parent', tip: 'a2aaaaa', landed: ['a1aaaaa'] },
  );
});

test('a head whose every commit main holds, or makes again, has no own work to start from: it is stacked on nothing', () => {
  assert.deepEqual(stacked([{ sha: 'a1aaaaa', landed: true, files: ['src/a.ts'] }, { sha: 'a2aaaaa', landed: false, files: [`${DIST}a.js`] }]), { kind: 'none' });
});

test('a commit with no files is own work, not a regenerated one', () => {
  assert.deepEqual(stacked([{ sha: 'a1aaaaa', landed: true, files: ['src/a.ts'] }, { sha: 'e1aaaaa', landed: false, files: [] }]), { kind: 'parent', tip: 'a1aaaaa', landed: ['a1aaaaa'] });
});

test('a landed commit after the own work is refused, whether or not one comes before it', () => {
  for (const head of [
    [{ sha: 'c1aaaaa', landed: false, files: ['src/c.ts'] }, { sha: 'a1aaaaaaaaa1', landed: true, files: ['src/a.ts'] }],
    [{ sha: 'a0aaaaa', landed: true, files: ['src/z.ts'] }, { sha: 'c1aaaaa', landed: false, files: ['src/c.ts'] }, { sha: 'a1aaaaaaaaa1', landed: true, files: ['src/a.ts'] }],
  ]) {
    assert.deepEqual(stacked(head), {
      kind: 'refused',
      why: "its commit a1aaaaaaa is on main already but follows the branch's own work: rebase it by hand, push it under a new name and merge that",
    });
  }
});
