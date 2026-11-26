import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testTask } from '../testing/task.ts';
import type { ApprovalAnswer, Task } from '../register/fold.ts';
import { answererClearance, clearanceText, overlapsOf, sensitivePathsOf, type AnswererChange, type MergeClearance } from './approval-clearance.ts';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const UNAPPROVED = 'T1 holds no approval of lead';
const reasonOf = (clearance: MergeClearance): string => (clearance.kind === 'refused' ? clearance.reason : `not refused: ${clearance.kind}`);
/** The answerer alpha, with charlie as the team's security reviewer. */
const STANDING = { caller: 'alpha', securityReviewer: 'charlie' } as const;
const change = (more: Partial<AnswererChange> = {}): AnswererChange => ({ paths: 3, sensitive: [], overlaps: [], ...more });
/** T1, alpha's, waiting on `who`'s approval and answered `note` by it. */
const answeredBy = (who: string, note: string): Task => {
  const answer: ApprovalAnswer = { verdict: 'approved', by: who, at: '2030-01-07T11:00:00.000Z', note };
  return testTask({ status: 'waiting', waits: [{ kind: 'approval', who }], answer });
};

describe("answererClearance: the answerer's own head, which no leader approved (T3448)", () => {
  it('clears a head with no sensitive path and no overlap alone, counting its paths', () => {
    assert.deepEqual(answererClearance(STANDING, testTask(), HEAD, UNAPPROVED, change()), { kind: 'low-risk', by: 'alpha', paths: 3 });
  });

  it('sends a sensitive head to the security reviewer, naming the head and the paths', () => {
    const reason = reasonOf(answererClearance(STANDING, testTask(), HEAD, UNAPPROVED, change({ sensitive: ['src/core/secrets.ts'] })));
    assert.match(reason, /^T1 touches the sensitive src\/core\/secrets\.ts: set it waiting approval:charlie and ask charlie to approve it naming 0123456789abcdef/);
  });

  it("clears a sensitive head on the security reviewer's approval naming it, and not on one naming another head", () => {
    const sensitive = change({ sensitive: ['src/core/secrets.ts'] });
    assert.deepEqual(answererClearance(STANDING, answeredBy('charlie', `OK ${HEAD.slice(0, 9)}`), HEAD, UNAPPROVED, sensitive), { kind: 'approved', by: 'charlie' });
    assert.match(reasonOf(answererClearance(STANDING, answeredBy('charlie', 'OK 9999999'), HEAD, UNAPPROVED, sensitive)), /set it waiting approval:charlie/);
    assert.match(reasonOf(answererClearance(STANDING, answeredBy('bravo', `OK ${HEAD}`), HEAD, UNAPPROVED, sensitive)), /set it waiting approval:charlie/, "another session's approval");
  });

  it('refuses a sensitive head in a team with no other security reviewer, keeping the leaders\' refusal first', () => {
    const sensitive = change({ sensitive: ['src/core/secrets.ts'] });
    for (const securityReviewer of [undefined, 'alpha']) {
      const reason = reasonOf(answererClearance({ caller: 'alpha', securityReviewer }, testTask(), HEAD, UNAPPROVED, sensitive));
      assert.match(reason, /^T1 holds no approval of lead; it touches the sensitive src\/core\/secrets\.ts, and the team has no other security reviewer to pass it first$/);
    }
  });

  it("leaves a head overlapping several sessions' open branches, or needing two sessions, to the leaders", () => {
    const bravo = { owner: 'bravo', tasks: ['T2'], paths: ['src/a.ts'] };
    const delta = { owner: 'delta', tasks: ['T3', 'T4'], paths: ['src/b.ts'] };
    assert.match(reasonOf(answererClearance(STANDING, testTask(), HEAD, UNAPPROVED, change({ overlaps: [bravo, delta] }))), /several sessions' open branches \(src\/a\.ts, which bravo's open T2 changes; src\/b\.ts, which delta's open T3, T4 change\), which the leaders approve$/);
    assert.match(reasonOf(answererClearance(STANDING, testTask(), HEAD, UNAPPROVED, change({ sensitive: ['src/core/secrets.ts'], overlaps: [bravo] }))), /^T1 holds no approval of lead; it touches the sensitive .* and src\/a\.ts, which bravo's open T2 changes, which the leaders approve$/);
  });

  it("sends a head overlapping one session's open branch to that session, cleared by its approval naming the head", () => {
    const overlaps = [{ owner: 'bravo', tasks: ['T2'], paths: ['src/a.ts'] }];
    assert.match(reasonOf(answererClearance(STANDING, testTask(), HEAD, UNAPPROVED, change({ overlaps }))), /set it waiting approval:bravo and ask bravo/);
    assert.deepEqual(answererClearance(STANDING, answeredBy('bravo', `OK ${HEAD}`), HEAD, UNAPPROVED, change({ overlaps })), { kind: 'approved', by: 'bravo' });
  });

  it('names the first five sensitive paths and counts the rest', () => {
    const sensitive = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `src/${name}.ts`);
    assert.match(reasonOf(answererClearance(STANDING, testTask(), HEAD, UNAPPROVED, change({ sensitive }))), /src\/e\.ts and 2 more:/);
  });
});

describe("overlapsOf: the files a head shares with other sessions' open branches (T3448)", () => {
  it('groups them by owner in branch order, each task and path once, and drops a branch sharing none', () => {
    const branches = [
      { task: 'T2', owner: 'bravo', paths: ['src/a.ts', 'src/z.ts'] },
      { task: 'T3', owner: 'charlie', paths: ['src/b.ts'] },
      { task: 'T5', owner: 'bravo', paths: ['src/a.ts', 'src/c.ts'] },
      { task: 'T6', owner: 'delta', paths: ['src/y.ts'] },
    ];
    assert.deepEqual(overlapsOf(['src/a.ts', 'src/b.ts', 'src/c.ts'], branches), [
      { owner: 'bravo', tasks: ['T2', 'T5'], paths: ['src/a.ts', 'src/c.ts'] },
      { owner: 'charlie', tasks: ['T3'], paths: ['src/b.ts'] },
    ]);
    assert.deepEqual(overlapsOf([], branches), []);
  });
});

describe('sensitivePathsOf: the paths no low-risk glob covers, or a sensitive one does, read as the review gate reads them', () => {
  it('matches a slash-less glob on a name at any depth, a slashed one from the root, case and dotfiles alike', () => {
    const sensitive = ['*guard*', 'tools/**', '.github/**'];
    const paths = ['src/Push-Guard.ts', 'src/push-guard/a.ts', 'lib/tools/x.ts', 'tools/x.ts', '.github/CODEOWNERS', 'src/a.ts'];
    assert.deepEqual(sensitivePathsOf(paths, { lowRisk: ['*'], sensitive }), ['src/Push-Guard.ts', 'tools/x.ts', '.github/CODEOWNERS'], 'a folder name needs a **/ glob');
    assert.deepEqual(sensitivePathsOf(['tools/x.ts'], { lowRisk: ['*'], sensitive: [] }), []);
  });

  it('holds every path no low-risk glob covers, whatever the sensitive globs leave out', () => {
    const lowRisk = ['docs/**', '*.test.ts'];
    const paths = ['docs/a.md', 'DOCS/b.md', 'src/a.test.ts', 'src/a.ts', 'lib/docs/c.md', 'new-folder/x.ts'];
    assert.deepEqual(sensitivePathsOf(paths, { lowRisk, sensitive: [] }), ['src/a.ts', 'lib/docs/c.md', 'new-folder/x.ts']);
    assert.deepEqual(sensitivePathsOf(paths, { lowRisk: [], sensitive: [] }), paths, 'no low-risk glob: all of them');
  });
});

describe('clearanceText: how the merge log names its clearance', () => {
  it('names the lead, the approver, or the answerer and the paths it counted', () => {
    assert.equal(clearanceText({ kind: 'self' }), "the caller's own, a root team's lead");
    assert.equal(clearanceText({ kind: 'approved', by: 'lead' }), 'approved by lead');
    assert.equal(clearanceText({ kind: 'low-risk', by: 'gh', paths: 4 }), 'low-risk, approved by gh, the answerer: 4 changed path(s), none sensitive');
  });
});
