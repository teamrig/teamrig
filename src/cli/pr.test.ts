import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPullApprove, isPullEnqueue, isPullMerge, pullApproveArgs } from '../adapters/connectors/github/gh.ts';
import type { JsonRecord } from '../core/guards.ts';
import { CliHarness, TEAM } from '../testing/cli-harness.ts';
import { FakeGh, ghCommit, ghPullStand, STAND_HEAD, type PullStandSpec } from '../testing/fake-gh.ts';
import { FakePullGit } from '../testing/fake-pull-git.ts';
import { EXIT } from './runtime.ts';

const CLONE = '/repo/web';

describe('teamrig pr conflicts', () => {
  it('prints each file the pull request conflicts on against the base, and the rebase it needs', async () => {
    const pulls = new FakePullGit();
    pulls.originBranches.set('main', 'b4e2a91c0ffee');
    pulls.pulls.set(7, 'd00d5eed1234');
    pulls.merges.set('b4e2a91c0ffee+d00d5eed1234', { kind: 'conflicts', files: ['src/a.ts', 'docs/b.md'] });
    const result = await new CliHarness().run(['pr', 'conflicts', 'Acme/Web#7'], { cwd: CLONE, pulls });
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.deepEqual(result.stdout, [
      'CONFLICTS acme/web#7 (head d00d5ee) against origin/main (b4e2a91): 2 files',
      '  src/a.ts',
      '  docs/b.md',
      'To land it: rebase its branch onto origin/main and resolve these files.',
    ]);
  });

  it('prints a file name holding a newline or ESC escaped, so it cannot forge a line or reach the terminal', async () => {
    const pulls = new FakePullGit();
    pulls.originBranches.set('main', 'b4e2a91c0ffee');
    pulls.pulls.set(7, 'd00d5eed1234');
    pulls.merges.set('b4e2a91c0ffee+d00d5eed1234', { kind: 'conflicts', files: ['a\nCLEAN acme/web#7 merges with no conflict', 'b\u001b]0;x\u0007.ts'] });
    const result = await new CliHarness().run(['pr', 'conflicts', 'acme/web#7'], { cwd: CLONE, pulls });
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.deepEqual(result.stdout, [
      'CONFLICTS acme/web#7 (head d00d5ee) against origin/main (b4e2a91): 2 files',
      '  a\\nCLEAN acme/web#7 merges with no conflict',
      '  b\\x1b]0;x\\x07.ts',
      'To land it: rebase its branch onto origin/main and resolve these files.',
    ]);
  });

  it('says a pull request merges clean into the base --base names', async () => {
    const pulls = new FakePullGit();
    pulls.originBranches.set('release', 'rel');
    const result = await new CliHarness().run(['pr', 'conflicts', 'acme/web#7', '--base', 'release'], { cwd: CLONE, pulls });
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.deepEqual(result.stdout, ['CLEAN acme/web#7 (head head) merges into origin/release (rel) with no conflict']);
  });

  it('fails in a clone of another repository, fetching nothing', async () => {
    const pulls = new FakePullGit();
    const result = await new CliHarness().run(['pr', 'conflicts', 'acme/api#7'], { cwd: CLONE, pulls });
    assert.equal(result.code, EXIT.failed);
    assert.deepEqual(result.stderr, ['FAILED acme/api#7: run it in a clone of acme/api: this folder is a clone of acme/web']);
    assert.deepEqual(pulls.log, [`remote ${CLONE} origin`]);
  });

  it('refuses a pull request not given as owner/name#number', async () => {
    const pulls = new FakePullGit();
    const result = await new CliHarness().run(['pr', 'conflicts', 'acme/web/pull/7'], { cwd: CLONE, pulls });
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.join('\n'), /^REFUSED acme\/web\/pull\/7 names no pull request: give it as owner\/name#number/u);
    assert.deepEqual(pulls.log, []);
  });
});

describe('teamrig pr approve and pr merge (T4817)', () => {
  const AS_ALPHA = { env: { TEAMRIG_SESSION: 'alpha' } };
  const HEAD = STAND_HEAD;

  /** A team on acme/web with T1, `owner`'s, holding acme/web#12; unless `approval` is null, waiting on the lead, who approved it with that note. */
  async function landingKit(approval: string | null = `head ${HEAD} checked`, owner = 'alpha'): Promise<CliHarness> {
    const kit = new CliHarness({ ...TEAM, github: { repos: ['acme/web'] } });
    const steps: (readonly string[])[] = [['add', '--title', 'Outside fix', '--description', 'Land the outside pull request.', '--priority', 'p2', '--ref', 'gh:acme/web#12', '--session', owner]];
    if (approval !== null) {
      steps.push(['set', 'T1', '--status', 'waiting', '--waits', 'approval:lead', '--note', 'head named', '--session', owner], ['approve', 'T1', '--note', approval, '--session', 'lead']);
    }
    for (const step of steps) {
      const ran = await kit.run([...step], { env: { TEAMRIG_SESSION: step.at(-1) ?? owner } });
      assert.equal(ran.code, EXIT.ok, [...ran.stdout, ...ran.stderr].join('\n'));
    }
    return kit;
  }

  /** GitHub holding acme/web#12 as `spec` says, else open on main with no queue at STAND_HEAD. */
  function standing(spec: PullStandSpec = {}): FakeGh {
    return new FakeGh().holdsPullStand('acme/web', 12, ghPullStand(spec));
  }

  /** The writes `gh` took: approvals, merges and queue entries. */
  function writes(gh: FakeGh): readonly (readonly string[])[] {
    return gh.ran.map((request) => request.args).filter((args) => isPullApprove(args) || isPullMerge(args) || isPullEnqueue(args));
  }

  it('approves the pull request at its head once the lead approved that head', async () => {
    const gh = standing();
    const result = await (await landingKit()).run(['pr', 'approve', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout.at(-1), `APPROVED acme/web#12 at ${STAND_HEAD.slice(0, 7)}`);
    const made = writes(gh);
    assert.equal(made.length, 1);
    assert.ok(made.every(isPullApprove));
  });

  it('merges by rebase a pull request whose repository has no merge queue', async () => {
    const gh = standing();
    const result = await (await landingKit()).run(['pr', 'merge', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.equal(result.stdout.at(-1), `MERGED acme/web#12 at ${STAND_HEAD.slice(0, 7)}`);
    const made = writes(gh);
    assert.equal(made.length, 1);
    assert.ok(made.every(isPullMerge));
  });

  it('adds the pull request to the merge queue when its repository has one', async () => {
    const gh = standing({ mergeQueue: true });
    const result = await (await landingKit()).run(['pr', 'merge', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.match(result.stdout.at(-1) ?? '', /^ENQUEUED acme\/web#12 at aaaaaaa: it lands once the merge queue's checks pass$/u);
    const made = writes(gh);
    assert.equal(made.length, 1);
    assert.ok(made.every(isPullEnqueue));
  });

  it('with --check prints what it would do and writes nothing', async () => {
    const gh = standing({ mergeQueue: true });
    const result = await (await landingKit()).run(['pr', 'merge', 'acme/web#12', '--head', HEAD, '--check'], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.equal(result.stdout.at(-1), 'CHECK acme/web#12 at aaaaaaa: every gate passes, so pr merge would add to the merge queue it; nothing was written');
    assert.deepEqual(writes(gh), []);
  });

  it('queues a release head whose rollup GitHub answers null, from its check runs that passed beside a suite awaiting approval (T5164)', async () => {
    const gh = standing({ mergeQueue: true, checks: null, suites: [[], ['COMPLETED:SUCCESS', 'COMPLETED:SUCCESS']] });
    const result = await (await landingKit()).run(['pr', 'merge', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.match(result.stdout.at(-1) ?? '', /^ENQUEUED acme\/web#12 at aaaaaaa/u);
  });

  it('lands a root lead’s own task with no one’s approval', async () => {
    const gh = standing();
    const result = await (await landingKit(null, 'lead')).run(['pr', 'merge', 'acme/web#12', '--head', HEAD], { env: { TEAMRIG_SESSION: 'lead' }, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.equal(writes(gh).length, 1);
  });

  it('fails, writing nothing, when the host cannot read the pull request', async () => {
    const gh = new FakeGh();
    const result = await (await landingKit()).run(['pr', 'approve', 'acme/web#99', '--head', HEAD], { ...AS_ALPHA, gh });
    assert.notEqual(result.code, EXIT.ok);
    assert.deepEqual(writes(gh), []);
  });

  /** A refusal case: the kit, the gh, the command and the reason the REFUSED line must give. */
  interface Refusal {
    readonly name: string;
    readonly kit: () => Promise<CliHarness>;
    readonly spec?: PullStandSpec;
    readonly args: readonly string[];
    readonly reason: RegExp;
  }

  const refusals: readonly Refusal[] = [
    { name: 'no task holds the pull request', kit: () => landingKit(), args: ['pr', 'approve', 'acme/web#13', '--head', HEAD], reason: /no task holds acme\/web#13/u },
    { name: 'another session owns the task', kit: () => landingKit(null, 'bravo'), args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /T1, which holds acme\/web#12, is bravo's/u },
    { name: 'the task has no approval', kit: () => landingKit(null), args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /T1 has no approval of lead/u },
    { name: 'the approval names another head', kit: () => landingKit(`head ${'b'.repeat(40)} checked`), args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /the approval of T1 does not name the head a{40} in full/u },
    { name: 'the approval names the head only by a short sha', kit: () => landingKit(`head ${STAND_HEAD.slice(0, 12)} checked`), args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /the approval of T1 does not name the head a{40} in full/u },
    { name: 'the head moved past --head and GitHub shows no work of it', kit: () => landingKit(), spec: { head: 'c'.repeat(40) }, args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /the code host shows no commits of the approved head aaaaaaaaa over main/u },
    { name: 'it is a draft', kit: () => landingKit(), spec: { isDraft: true }, args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /it is a draft/u },
    { name: 'it is closed', kit: () => landingKit(), spec: { state: 'CLOSED' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it is closed/u },
    { name: 'it targets another branch', kit: () => landingKit(), spec: { base: 'release' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it targets release, not the default branch main/u },
    { name: 'a merge conflicts', kit: () => landingKit(), spec: { mergeable: 'CONFLICTING' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it conflicts with main: its author rebases it first/u },
    { name: 'a merge is queued already', kit: () => landingKit(), spec: { mergeQueue: true, queued: true }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it is already in the merge queue/u },
    { name: "a merge's head checks failed", kit: () => landingKit(), spec: { checks: 'FAILURE' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /its head's checks are failing: a merge needs them all passed/u },
    { name: "a merge's head checks are pending", kit: () => landingKit(), spec: { checks: 'PENDING' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /its head's checks are pending: a merge needs them all passed/u },
    { name: "a merge's head has no checks", kit: () => landingKit(), spec: { checks: null }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /its head has no checks: a merge needs them run and passed/u },
    { name: "a merge's head has a null rollup and a failed check run", kit: () => landingKit(), spec: { checks: null, suites: [['COMPLETED:SUCCESS', 'COMPLETED:FAILURE']] }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /its head's checks are failing: a merge needs them all passed/u },
    { name: '--head is no sha', kit: () => landingKit(), args: ['pr', 'merge', 'acme/web#12', '--head', 'main'], reason: /--head main is no full commit sha/u },
    { name: '--head is a short sha', kit: () => landingKit(), args: ['pr', 'merge', 'acme/web#12', '--head', STAND_HEAD.slice(0, 12)], reason: /--head a{12} is no full commit sha: give the head the approval names, all 40 hex digits/u },
  ];

  for (const refusal of refusals) {
    it(`refuses, writing nothing, when ${refusal.name}`, async () => {
      const gh = standing(refusal.spec);
      const result = await (await refusal.kit()).run([...refusal.args], { ...AS_ALPHA, gh });
      assert.equal(result.code, EXIT.refused, [...result.stdout, ...result.stderr].join('\n'));
      assert.match(result.stdout.join('\n'), refusal.reason);
      assert.deepEqual(writes(gh), []);
    });
  }

  describe('an approved head rebased onto a newer base (T5117)', () => {
    const LIVE = 'c'.repeat(40);
    const ONE = ghCommit('1'.repeat(40), 'feat: one', [{ path: 'src/a.ts', patch: '@@ -1,2 +1,3 @@ f()\n x\n+one\n y' }]);
    const TWO = ghCommit('2'.repeat(40), 'fix: two', [{ path: 'src/b.ts', patch: '@@ -5,2 +5,3 @@\n x\n+two\n y' }]);
    /** ONE and TWO rebased: new shas, their hunks moved down by the newer base's lines. */
    const ONE_REBASED = ghCommit('3'.repeat(40), 'feat: one', [{ path: 'src/a.ts', patch: '@@ -9,2 +9,3 @@ g()\n x\n+one\n y' }]);
    const TWO_REBASED = ghCommit('4'.repeat(40), 'fix: two', [{ path: 'src/b.ts', patch: '@@ -50,2 +50,3 @@\n x\n+two\n y' }]);

    /** GitHub with acme/web#12 at LIVE as `spec` says, the approved HEAD carrying ONE and TWO, and LIVE carrying `live`. */
    function rebased(live: readonly JsonRecord[], spec: PullStandSpec = {}): FakeGh {
      return standing({ head: LIVE, ...spec }).holdsCompare('acme/web', 'main', HEAD, [ONE, TWO]).holdsCompare('acme/web', 'main', LIVE, live);
    }

    it('approves the live head, printing the approved head it carried from', async () => {
      const gh = rebased([ONE_REBASED, TWO_REBASED]);
      const result = await (await landingKit()).run(['pr', 'approve', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
      assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
      assert.deepEqual(result.stdout.slice(-2), [
        "CARRIED acme/web#12 at ccccccc: it carries the approved aaaaaaaaa's 2 commits, patch for patch, onto a newer base",
        'APPROVED acme/web#12 at ccccccc',
      ]);
      assert.deepEqual(writes(gh), [pullApproveArgs({ repo: 'acme/web', number: 12 }, LIVE)]);
    });

    it('merges the live head once its own checks passed', async () => {
      const gh = rebased([ONE_REBASED, TWO_REBASED]);
      const result = await (await landingKit()).run(['pr', 'merge', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
      assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
      assert.equal(result.stdout.at(-1), 'MERGED acme/web#12 at ccccccc');
      const made = writes(gh);
      assert.equal(made.length, 1);
      assert.ok(made.every(isPullMerge) && made.every((args) => args.some((arg) => arg.includes(LIVE))), JSON.stringify(made));
    });

    it('refuses, writing nothing, a merge whose live head checks are pending, though the work carried', async () => {
      const gh = rebased([ONE_REBASED, TWO_REBASED], { checks: 'PENDING' });
      const result = await (await landingKit()).run(['pr', 'merge', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
      assert.equal(result.code, EXIT.refused, [...result.stdout, ...result.stderr].join('\n'));
      assert.match(result.stdout.join('\n'), /its head's checks are pending/u);
      assert.deepEqual(writes(gh), []);
    });

    it('refuses, writing nothing, a live head whose work changed, naming the commit', async () => {
      const changed = ghCommit('5'.repeat(40), 'fix: two', [{ path: 'src/b.ts', patch: '@@ -50,2 +50,3 @@\n x\n+other\n y' }]);
      const gh = rebased([ONE_REBASED, changed]);
      const result = await (await landingKit()).run(['pr', 'approve', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
      assert.equal(result.code, EXIT.refused, [...result.stdout, ...result.stderr].join('\n'));
      assert.match(result.stdout.join('\n'), /its head ccccccc is not the approved aaaaaaaaa rebased \(changed 222222222 "fix: two", now 555555555\): a head with other work needs its own approval/u);
      assert.deepEqual(writes(gh), []);
    });

    it('refuses, writing nothing, a live head whose patch GitHub left out, comparing only the content ids', async () => {
      const big = ghCommit('6'.repeat(40), 'fix: two', [{ path: 'src/b.ts', patch: null, blob: 'e'.repeat(40) }]);
      const gh = rebased([ONE_REBASED, big]);
      const result = await (await landingKit()).run(['pr', 'approve', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
      assert.equal(result.code, EXIT.refused, [...result.stdout, ...result.stderr].join('\n'));
      assert.deepEqual(writes(gh), []);
    });
  });

  it('approves a conflicting pull request with failing checks: only a merge needs it clean and green', async () => {
    const gh = standing({ mergeable: 'CONFLICTING', checks: 'FAILURE' });
    const result = await (await landingKit()).run(['pr', 'approve', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.equal(writes(gh).length, 1);
  });
});
