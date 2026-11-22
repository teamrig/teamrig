import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPullApprove, isPullEnqueue, isPullMerge } from '../adapters/connectors/github/gh.ts';
import { CliHarness, TEAM } from '../testing/cli-harness.ts';
import { FakeGh, ghPullStand, STAND_HEAD, type PullStandSpec } from '../testing/fake-gh.ts';
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
  const HEAD = STAND_HEAD.slice(0, 12);

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
    { name: 'the approval names another head', kit: () => landingKit('head bbbbbbbbbbbb checked'), args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /the approval of T1 names no sha its head aaaaaaa starts with/u },
    { name: 'the head moved past --head', kit: () => landingKit(), spec: { head: 'c'.repeat(40) }, args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /its head is ccccccc, not aaaaaaaaaaaa: a newer head needs its own approval/u },
    { name: 'it is a draft', kit: () => landingKit(), spec: { isDraft: true }, args: ['pr', 'approve', 'acme/web#12', '--head', HEAD], reason: /it is a draft/u },
    { name: 'it is closed', kit: () => landingKit(), spec: { state: 'CLOSED' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it is closed/u },
    { name: 'it targets another branch', kit: () => landingKit(), spec: { base: 'release' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it targets release, not the default branch main/u },
    { name: 'a merge conflicts', kit: () => landingKit(), spec: { mergeable: 'CONFLICTING' }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it conflicts with main: its author rebases it first/u },
    { name: 'a merge is queued already', kit: () => landingKit(), spec: { mergeQueue: true, queued: true }, args: ['pr', 'merge', 'acme/web#12', '--head', HEAD], reason: /it is already in the merge queue/u },
    { name: '--head is no sha', kit: () => landingKit(), args: ['pr', 'merge', 'acme/web#12', '--head', 'main'], reason: /--head main is no commit sha/u },
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

  it('approves a conflicting pull request: only a merge needs it clean', async () => {
    const gh = standing({ mergeable: 'CONFLICTING' });
    const result = await (await landingKit()).run(['pr', 'approve', 'acme/web#12', '--head', HEAD], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.equal(writes(gh).length, 1);
  });
});
