import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ProgramRequest, ProgramResult } from '../core/program-runner.ts';
import { channelListingArgs, channelReleaseOf, cloneRelease, isKitChannel, KIT_RELEASE_REPO, listChannel, type KitRelease } from './kit-release.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const TAG_OBJECT = 'c'.repeat(40);
const GIT = '/usr/bin/git';
const FOLDER = '/srv/kit/install/kit-update-1';

function ok(stdout = ''): ProgramResult {
  return { end: { kind: 'exited', code: 0 }, stdout, stderr: '' };
}

/** A git that answers each run with the next result, recording what it was asked. */
function scriptedGit(results: readonly ProgramResult[]): { readonly run: (request: ProgramRequest) => Promise<ProgramResult>; readonly asked: ProgramRequest[] } {
  const asked: ProgramRequest[] = [];
  const queue = [...results];
  return {
    asked,
    run: (request) => {
      asked.push(request);
      const next = queue.shift();
      return next === undefined ? Promise.reject(new Error('no more runs')) : Promise.resolve(next);
    },
  };
}

describe('isKitChannel', () => {
  it('names stable and preview, nothing else', () => {
    assert.deepEqual(['stable', 'preview', 'main', 'toString'].map(isKitChannel), [true, true, false, false]);
  });
});

describe('channelReleaseOf', () => {
  it("takes the annotated tag's peeled commit at the branch head", () => {
    const listing = [`${HEAD}\trefs/heads/release`, `${TAG_OBJECT}\trefs/tags/v0.510.0`, `${HEAD}\trefs/tags/v0.510.0^{}`, `${OLDER}\trefs/tags/v0.509.0`].join('\n');
    assert.deepEqual(channelReleaseOf(listing, 'release'), { kind: 'release', release: { tag: 'v0.510.0', commit: HEAD, version: '0.510.0' } });
  });

  it('takes a lightweight tag, and the newest of two tags on one commit', () => {
    const listing = [`${HEAD}\trefs/tags/v0.509.0`, `${HEAD}\trefs/tags/v0.511.0`, `${HEAD}\trefs/heads/preview`, ''].join('\r\n');
    assert.deepEqual(channelReleaseOf(listing, 'preview'), { kind: 'release', release: { tag: 'v0.511.0', commit: HEAD, version: '0.511.0' } });
  });

  it('ignores a tag that is no release version and another branch', () => {
    const listing = [`${HEAD}\trefs/heads/release`, `${HEAD}\trefs/tags/v1.0`, `${HEAD}\trefs/tags/v0.510.0-rc1`, `${OLDER}\trefs/heads/preview`, `${OLDER}\trefs/tags/v0.510.0`].join('\n');
    assert.equal(channelReleaseOf(listing, 'release').kind, 'none');
  });

  it('says why when the branch is missing or its head is not tagged yet', () => {
    assert.deepEqual(channelReleaseOf(`${OLDER}\trefs/tags/v0.509.0`, 'release'), { kind: 'none', why: 'the repository has no branch release' });
    assert.deepEqual(channelReleaseOf(`${HEAD}\trefs/heads/release\n${OLDER}\trefs/tags/v0.509.0`, 'release'), {
      kind: 'none',
      why: `the head of release, ${HEAD}, carries no release tag yet; run this again once the release is tagged`,
    });
  });
});

describe('listChannel', () => {
  it('asks the public repository for the branch head and the release tags', async () => {
    const git = scriptedGit([ok('listing')]);
    assert.deepEqual(await listChannel({ git: GIT, run: git.run }, 'preview'), { kind: 'listed', text: 'listing' });
    assert.deepEqual(git.asked, [{ program: GIT, args: channelListingArgs('preview') }]);
    assert.deepEqual(channelListingArgs('preview'), ['ls-remote', KIT_RELEASE_REPO, 'refs/heads/preview', 'refs/tags/v*']);
  });

  it("names the failed run's exit and last line", async () => {
    const git = scriptedGit([{ end: { kind: 'exited', code: 128 }, stdout: '', stderr: 'warning\nfatal: unable to access\n' }]);
    assert.deepEqual(await listChannel({ git: GIT, run: git.run }, 'release'), {
      kind: 'failed',
      why: `git ls-remote ${KIT_RELEASE_REPO} failed (exit 128): fatal: unable to access`,
    });
  });
});

describe('cloneRelease', () => {
  const release: KitRelease = { tag: 'v0.510.0', commit: HEAD, version: '0.510.0' };

  it('clones by the tag, one commit deep, and returns the plugin folder once HEAD is the tag commit', async () => {
    const git = scriptedGit([ok(), ok(`${HEAD}\n`)]);
    assert.deepEqual(await cloneRelease({ git: GIT, run: git.run }, release, FOLDER), { kind: 'cloned', pluginRoot: join(FOLDER, 'plugins', 'teamrig') });
    assert.deepEqual(
      git.asked.map((each) => each.args),
      [
        ['-c', 'advice.detachedHead=false', 'clone', '-q', '--depth', '1', '--branch', 'v0.510.0', KIT_RELEASE_REPO, FOLDER],
        ['-C', FOLDER, 'rev-parse', 'HEAD'],
      ],
    );
  });

  it('refuses a clone whose HEAD is not the listed commit, as a tag moved since', async () => {
    const git = scriptedGit([ok(), ok(`${OLDER}\n`)]);
    assert.deepEqual(await cloneRelease({ git: GIT, run: git.run }, release, FOLDER), {
      kind: 'failed',
      why: `the clone of v0.510.0 is at ${OLDER}, not the tag's commit ${HEAD}`,
    });
  });

  it('names a failed clone and a failed read of its commit', async () => {
    const stopped = scriptedGit([{ end: { kind: 'signal', signal: 'SIGTERM' }, stdout: '', stderr: '' }]);
    assert.deepEqual(await cloneRelease({ git: GIT, run: stopped.run }, release, FOLDER), { kind: 'failed', why: 'git clone --branch v0.510.0 failed (stopped by SIGTERM)' });
    const unread = scriptedGit([ok(), { end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'fatal: not a git repository' }]);
    assert.deepEqual(await cloneRelease({ git: GIT, run: unread.run }, release, FOLDER), {
      kind: 'failed',
      why: 'git rev-parse HEAD in the clone failed (exit 1): fatal: not a git repository',
    });
  });
});
