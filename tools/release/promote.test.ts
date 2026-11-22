import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GitError, type Git } from '../lib/git.ts';
import { TempRepo } from '../lib/temp-repo.ts';
import { parseChannels } from './channels.ts';
import { compareTags, parseHold, previewReleases, promote, readHold, type Hotfix, type Promotion } from './promote.ts';

/** Stable moves at 20:00 Asia/Jerusalem, 18:00 UTC in winter, to a release 3 h old by then: published by 15:00 UTC. */
const CHANNELS = parseChannels(JSON.stringify({ zone: 'Asia/Jerusalem', previewSlots: ['09:00'], stableAt: '20:00', soakHours: 3 }));
const at = (utc: string): Date => new Date(`2026-11-22T${utc}Z`);

/** git in the temp repo's own environment, so no global config of the machine running the tests reaches it. */
function gitIn(repo: TempRepo): Git {
  const run = (args: readonly string[]): Buffer => {
    const result = spawnSync('git', [...args], { cwd: repo.dir, env: repo.env });
    if (result.status !== 0) throw new GitError(args, result.stderr.toString('utf8'), result.status);
    return result.stdout;
  };
  return { text: async (args) => run(args).toString('utf8'), bytes: async (args) => run(args) };
}

describe('promote', () => {
  let repo: TempRepo;
  let git: Git;
  let origin: string;
  let stable: string;
  /** Each preview release's commit by its tag. */
  let releases: Map<string, string>;
  const lines: string[] = [];

  /** A commit on `parent` made at `utc` on 2026-11-22, as publish.ts makes a release commit when it runs. */
  function commitAt(parent: string | undefined, content: string, utc: string): string {
    repo.write('plugin.txt', content);
    repo.git('add', '-A');
    const tree = repo.git('write-tree').trim();
    const date = `2026-11-22T${utc}Z`;
    const args = ['commit-tree', tree, ...(parent === undefined ? [] : ['-p', parent]), '-m', content];
    const result = spawnSync('git', args, { cwd: repo.dir, env: { ...repo.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }

  const remote = (ref: string): string => repo.git('ls-remote', origin, ref).split('\t')[0] ?? '';
  const promotion = (over: Partial<Promotion> = {}): Promotion => ({ remote: 'origin', channels: CHANNELS, held: new Map(), now: at('19:00:00'), hotfix: undefined, dryRun: false, ...over });
  const run = (over: Partial<Promotion> = {}) => promote(git, promotion(over), (line) => lines.push(line));
  const hotfix = (tag: string): Hotfix => ({ tag, sha: releases.get(tag) ?? '' });

  beforeEach(() => {
    repo = new TempRepo('promote').init();
    origin = join(repo.outside, 'origin.git');
    repo.git('init', '-q', '--bare', origin);
    repo.git('remote', 'add', 'origin', origin);
    git = gitIn(repo);
    lines.length = 0;
    stable = commitAt(undefined, 'v1.0.0', '08:00:00');
    releases = new Map();
    let last = stable;
    for (const [tag, utc] of [['v1.1.0', '10:00:00'], ['v1.2.0', '14:00:00'], ['v1.3.0', '16:00:00']] as const) {
      last = commitAt(last, tag, utc);
      releases.set(tag, last);
      repo.git('tag', tag, last);
    }
    repo.git('tag', 'v1.0.0', stable);
    repo.git('push', '-q', 'origin', `${stable}:refs/heads/release`, `${last}:refs/heads/preview`, '--tags');
    // The tags were made here; the promote job reads them from the remote, as a fresh checkout does.
    for (const tag of ['v1.0.0', ...releases.keys()]) repo.git('tag', '-d', tag);
  });

  afterEach(() => repo.remove());

  it('moves stable to the newest preview release soaked by its last move, a fast-forward without force', async () => {
    const result = await run();
    assert.deepEqual(result, { moved: true, tag: 'v1.2.0', sha: releases.get('v1.2.0') });
    assert.equal(remote('refs/heads/release'), releases.get('v1.2.0'));
    assert.deepEqual(lines, [`promote: moved release from ${stable} to v1.2.0 (${releases.get('v1.2.0')})`]);
  });

  it('picks the same release on every run until the next move, so a repeat changes nothing', async () => {
    await run();
    const again = await run({ now: at('23:59:00') });
    assert.deepEqual(again, { moved: false, reason: 'stable already holds v1.2.0' });
    assert.equal(remote('refs/heads/release'), releases.get('v1.2.0'));
  });

  it("measures the soak from yesterday's move before today's stable time", async () => {
    const result = await run({ now: at('17:59:00') });
    assert.deepEqual(result, { moved: false, reason: 'no preview release soaked 3 h by 2026-11-21T18:00:00.000Z' });
    assert.equal(remote('refs/heads/release'), stable);
  });

  it('skips only a held version, taking the newest one below it', async () => {
    const result = await run({ held: new Map([['v1.2.0', 'breaks the update notice']]) });
    assert.deepEqual(result, { moved: true, tag: 'v1.1.0', sha: releases.get('v1.1.0') });
  });

  it('says on a dry run what it would move, and pushes nothing', async () => {
    const result = await run({ dryRun: true });
    assert.deepEqual(result, { moved: false, reason: 'dry run' });
    assert.equal(remote('refs/heads/release'), stable);
    assert.deepEqual(lines, [`promote: would move release from ${stable} to v1.2.0 (${releases.get('v1.2.0')}); dry run, nothing pushed`]);
  });

  it('promotes a hotfix tag at once, with no soak, and the scheduled run then leaves stable there', async () => {
    const result = await run({ hotfix: hotfix('v1.3.0') });
    assert.deepEqual(result, { moved: true, tag: 'v1.3.0', sha: releases.get('v1.3.0') });
    assert.match(lines[0] ?? '', /, a hotfix$/);
    const scheduled = await run();
    assert.deepEqual(scheduled, { moved: false, reason: `stable's ${releases.get('v1.3.0')} is not behind v1.2.0 on the preview chain` });
    assert.equal(remote('refs/heads/release'), releases.get('v1.3.0'));
  });

  for (const [what, make, expected] of [
    ['a tag naming another commit than the approved one', (): Hotfix => ({ tag: 'v1.3.0', sha: releases.get('v1.2.0') ?? '' }), /v1\.3\.0 names [0-9a-f]{40}, not the approved/],
    ['a tag not on the preview branch', (): Hotfix => ({ tag: 'v9.0.0', sha: 'a'.repeat(40) }), /v9\.0\.0 is not a release on the preview branch/],
    ['a malformed tag', (): Hotfix => ({ tag: 'latest', sha: 'a'.repeat(40) }), /not v<MAJOR\.MINOR\.PATCH>/],
    ['a short sha', (): Hotfix => ({ tag: 'v1.3.0', sha: 'abc' }), /not a full commit sha/],
    ['the release stable holds', (): Hotfix => ({ tag: 'v1.0.0', sha: stable }), /stable already holds v1\.0\.0/],
  ] as const) {
    it(`refuses a hotfix of ${what}, moving nothing`, async () => {
      await assert.rejects(run({ hotfix: make() }), expected);
      assert.equal(remote('refs/heads/release'), stable);
    });
  }

  it('refuses a hotfix of a held tag, and one stable is already past', async () => {
    await assert.rejects(run({ hotfix: hotfix('v1.3.0'), held: new Map([['v1.3.0', 'bad build']]) }), /v1\.3\.0 is held: bad build/);
    await run({ hotfix: hotfix('v1.3.0') });
    await assert.rejects(run({ hotfix: hotfix('v1.2.0') }), /v1\.2\.0 does not move stable's [0-9a-f]{40} forward/);
  });

  it('does nothing on a remote with no preview branch, and refuses a hotfix there', async () => {
    repo.git('push', '-q', 'origin', ':refs/heads/preview');
    assert.deepEqual(await run(), { moved: false, reason: 'the remote has no preview branch yet' });
    await assert.rejects(run({ hotfix: hotfix('v1.3.0') }), /the remote has no preview branch/);
  });

  it("reads an annotated tag's commit and its date, and leaves out a tag of another shape", async () => {
    const annotated = commitAt(releases.get('v1.3.0'), 'v1.4.0', '11:00:00');
    repo.git('tag', '-a', '-m', 'v1.4.0', 'v1.4.0', annotated);
    repo.git('tag', 'v-next', annotated);
    repo.git('push', '-q', 'origin', `${annotated}:refs/heads/preview`, 'refs/tags/v1.4.0', 'refs/tags/v-next');
    const found = await previewReleases(git, 'origin', annotated);
    assert.deepEqual(found.find((release) => release.tag === 'v1.4.0'), { tag: 'v1.4.0', sha: annotated, published: at('11:00:00') });
    assert.equal(found.some((release) => release.tag === 'v-next'), false);
  });
});

describe('compareTags', () => {
  it('orders tags by version number, not by text', () => {
    assert.ok(compareTags('v1.10.0', 'v1.9.0') > 0);
    assert.ok(compareTags('v1.2.3', 'v1.2.4') < 0);
    assert.equal(compareTags('v2.0.0', 'v2.0.0'), 0);
  });
});

describe('parseHold', () => {
  it('reads each held tag with its reason', () => {
    assert.deepEqual(parseHold('{"v1.2.0": "breaks the update notice"}'), new Map([['v1.2.0', 'breaks the update notice']]));
  });

  it("reads the repo's own release-hold.json", () => {
    assert.ok(readHold() instanceof Map);
  });

  for (const [what, text, expected] of [
    ['a list', '[]', /expected \{/],
    ['a tag of another shape', '{"1.2.0": "why"}', /1\.2\.0 is not a v<MAJOR\.MINOR\.PATCH> tag/],
    ['a tag with no reason', '{"v1.2.0": " "}', /v1\.2\.0 says no reason/],
    ['a reason that is not text', '{"v1.2.0": true}', /v1\.2\.0 says no reason/],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.throws(() => parseHold(text), expected);
    });
  }
});
