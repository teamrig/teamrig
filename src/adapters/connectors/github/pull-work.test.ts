import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commitIn, compareIn } from './pull-work.ts';

describe('compareIn (T5117)', () => {
  it("reads the commits' shas in order and the total the head carries", () => {
    assert.deepEqual(compareIn(JSON.stringify({ total_commits: 3, commits: [{ sha: 'a' }, { sha: 'b' }] })), { shas: ['a', 'b'], total: 3 });
  });

  it('reads nothing from an answer off its shape', () => {
    assert.equal(compareIn('not json'), undefined);
    assert.equal(compareIn(JSON.stringify({ commits: [] })), undefined);
    assert.equal(compareIn(JSON.stringify({ total_commits: 1, commits: [{ sha: 1 }] })), undefined);
    assert.equal(compareIn(JSON.stringify({ total_commits: 1, commits: 'a' })), undefined);
  });
});

describe('commitIn (T5117)', () => {
  const FILE = { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b', sha: 'f'.repeat(40) };

  it("reads the sha, the message's first line, the parents counted and each file's change", () => {
    const answer = { sha: 'c'.repeat(40), commit: { message: 'feat: one\n\nbody' }, parents: [{ sha: 'p' }, { sha: 'q' }], files: [FILE] };
    assert.deepEqual(commitIn(JSON.stringify(answer)), {
      sha: 'c'.repeat(40),
      subject: 'feat: one',
      parents: 2,
      files: [{ path: 'src/a.ts', previousPath: null, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b', blob: 'f'.repeat(40) }],
    });
  });

  it('reads a rename with its old path, and a file with no patch as null', () => {
    const renamed = { filename: 'b.png', previous_filename: 'a.png', status: 'renamed', sha: 'e'.repeat(40) };
    const read = commitIn(JSON.stringify({ sha: 's', commit: { message: 'chore: move' }, parents: [{}], files: [renamed] }));
    assert.deepEqual(read?.files, [{ path: 'b.png', previousPath: 'a.png', status: 'renamed', patch: null, blob: 'e'.repeat(40) }]);
  });

  it('reads nothing from an answer off its shape, a file of it included', () => {
    assert.equal(commitIn('['), undefined);
    assert.equal(commitIn(JSON.stringify({ sha: 's', commit: {}, parents: [], files: [] })), undefined);
    assert.equal(commitIn(JSON.stringify({ sha: 's', commit: { message: 'm' }, parents: [], files: [{ ...FILE, patch: 3 }] })), undefined);
    assert.equal(commitIn(JSON.stringify({ sha: 's', commit: { message: 'm' }, parents: [], files: [{ ...FILE, previous_filename: 1 }] })), undefined);
  });
});
