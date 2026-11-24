import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { profileFor, readProfiles, type RepoProfile } from '../ship/repos.ts';
import { parseChannels } from './channels.ts';
import type { Fetch } from './release-merge.ts';
import { pullUpdate, pullUpdateCommand, releaseHead, type ReleaseHead } from './pull-update.ts';

const CHANNELS = parseChannels(JSON.stringify({ zone: 'Asia/Jerusalem', previewSlots: ['09:00', '12:00', '21:00'], stableAt: '20:00', soakHours: 3 }));
/** 09:00 in Asia/Jerusalem, winter time (UTC+2). */
const SLOT_START = new Date('2026-11-22T07:00:00Z');
const minutesAfter = (minutes: number): Date => new Date(SLOT_START.getTime() + minutes * 60_000);
const headAt = (at: Date): ReleaseHead => ({ kind: 'one', committedAt: at });
/** The release pull request's head as the last slot (21:00 the day before) left it. */
const OLD_HEAD = headAt(new Date('2026-11-21T19:05:00Z'));

const REPO = 'acme/tool';
const HEAD = 'release-please--branches--main';
const SHA = 'a'.repeat(40);
const BRANCH = { repo: REPO, main: 'main', head: HEAD };
const OPEN = `/pulls?state=open&base=main&head=${encodeURIComponent(`acme:${HEAD}`)}&per_page=100`;
const COMMIT = `/commits/${SHA}`;

describe('pullUpdate', () => {
  it('moves the release pull request on the hourly run once its head predates the slot', () => {
    assert.deepEqual(pullUpdate('schedule', minutesAfter(1), CHANNELS, OLD_HEAD), {
      update: true,
      reason: "the release pull request's head predates the 09:00 slot: it takes main's commits",
    });
  });

  it('moves it on a scheduled run GitHub delayed past the slot’s first hour', () => {
    assert.equal(pullUpdate('schedule', minutesAfter(150), CHANNELS, OLD_HEAD).update, true);
  });

  it('moves it on a push after the slot started when its head is older, so no hourly run is needed', () => {
    assert.deepEqual(pullUpdate('push', minutesAfter(95), CHANNELS, OLD_HEAD), {
      update: true,
      reason: "the release pull request's head predates the 09:00 slot: it takes main's commits",
    });
  });

  it('leaves it still on a second run in the same slot, push or schedule, so its ci finishes', () => {
    const moved = headAt(minutesAfter(3));
    assert.deepEqual(pullUpdate('push', minutesAfter(40), CHANNELS, moved), {
      update: false,
      reason: 'the release pull request already moved in the 09:00 slot: it stays as it is until the next slot',
    });
    assert.equal(pullUpdate('schedule', minutesAfter(61), CHANNELS, moved).update, false);
  });

  it('counts the slot that wraps past midnight from its own start', () => {
    // 01:30 the next day falls in the 21:00 slot, which started 19:00 UTC.
    assert.equal(pullUpdate('push', new Date('2026-11-22T23:30:00Z'), CHANNELS, headAt(new Date('2026-11-22T19:10:00Z'))).update, false);
    assert.equal(pullUpdate('push', new Date('2026-11-22T23:30:00Z'), CHANNELS, headAt(new Date('2026-11-22T18:50:00Z'))).update, true);
  });

  it('lets release-please open one when none is open', () => {
    assert.deepEqual(pullUpdate('push', minutesAfter(5), CHANNELS, { kind: 'none' }), {
      update: true,
      reason: 'no release pull request is open: release-please may open one',
    });
  });

  it('moves none of two open release pull requests', () => {
    assert.deepEqual(pullUpdate('schedule', minutesAfter(5), CHANNELS, { kind: 'many', count: 2 }), {
      update: false,
      reason: '2 open pull requests come from the release branch: none is moved',
    });
  });

  it('updates it on a run by hand, at any time', () => {
    assert.equal(pullUpdate('workflow_dispatch', minutesAfter(120), CHANNELS, headAt(minutesAfter(110))).update, true);
  });

  it('refuses an event release.yml does not run on', () => {
    assert.throws(() => pullUpdate('pull_request', minutesAfter(1), CHANNELS, OLD_HEAD), /not pull_request/);
  });
});

/** A fake repository reader answering by path, recording each path read. */
function reader(answers: Readonly<Record<string, unknown>>) {
  const read: string[] = [];
  const get = async (path: string): Promise<unknown> => {
    read.push(path);
    if (!(path in answers)) throw new Error(`no fake answer for ${path}`);
    return answers[path];
  };
  return { get, read };
}

describe('releaseHead', () => {
  it("reads the one open release pull request's head commit time", async () => {
    const fake = reader({ [OPEN]: [{ number: 12, head: { sha: SHA } }], [COMMIT]: { commit: { committer: { date: '2026-11-22T07:03:00Z' } } } });
    assert.deepEqual(await releaseHead(fake.get, BRANCH), { kind: 'one', committedAt: new Date('2026-11-22T07:03:00Z') });
    assert.deepEqual(fake.read, [OPEN, COMMIT]);
  });

  it('reads no commit when none or more than one is open', async () => {
    const none = reader({ [OPEN]: [] });
    assert.deepEqual(await releaseHead(none.get, BRANCH), { kind: 'none' });
    assert.deepEqual(none.read, [OPEN]);
    assert.deepEqual(await releaseHead(reader({ [OPEN]: [{ number: 12 }, { number: 13 }] }).get, BRANCH), { kind: 'many', count: 2 });
  });

  it('throws on answers of another shape', async () => {
    await assert.rejects(releaseHead(reader({ [OPEN]: [{ number: 12, head: { sha: 'abc' } }] }).get, BRANCH), /head\.sha is not a commit sha/);
    await assert.rejects(releaseHead(reader({ [OPEN]: [{ number: 12, head: { sha: SHA } }], [COMMIT]: { commit: {} } }).get, BRANCH), /committer\.date is not a time/);
  });
});

describe('pullUpdateCommand', () => {
  const PROFILE: RepoProfile = { ...profileFor(readProfiles(), 'teamrig/teamrig'), main: 'main', release: { head: HEAD, changelog: 'CHANGELOG.md' } };
  const PROFILES: ReadonlyMap<string, RepoProfile> = new Map([[REPO, PROFILE]]);
  let dir: string;
  let output: string;
  let summary: string;
  const lines: string[] = [];
  const tokens: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pull-update-'));
    output = join(dir, 'output');
    summary = join(dir, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
    lines.length = 0;
    tokens.length = 0;
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A fetch answering GitHub's paths from fixed answers, recording the token each call carried. */
  const fetchOf = (answers: Readonly<Record<string, unknown>>): Fetch => async (url, init) => {
    tokens.push(new Headers(init.headers).get('authorization') ?? '');
    const path = url.replace(`https://api.github.com/repos/${REPO}`, '');
    if (!(path in answers)) return new Response('', { status: 404 });
    return new Response(JSON.stringify(answers[path]), { status: 200 });
  };
  const OLD = { [OPEN]: [{ number: 12, head: { sha: SHA } }], [COMMIT]: { commit: { committer: { date: '2026-11-21T19:05:00Z' } } } };

  const run = (env: Readonly<Record<string, string | undefined>>, now: Date, answers: Readonly<Record<string, unknown>> = OLD): Promise<number> =>
    pullUpdateCommand(
      { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'job-token', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
      { profiles: PROFILES, fetchFn: fetchOf(answers), channels: CHANNELS, now, out: (line) => lines.push(line) },
    );

  it("writes update=true and its reason on a push after the slot started, read with the job's token", async () => {
    assert.equal(await run({ GITHUB_EVENT_NAME: 'push' }, minutesAfter(95)), 0);
    const line = "Release pull request: updates: the release pull request's head predates the 09:00 slot: it takes main's commits";
    assert.equal(readFileSync(output, 'utf8'), 'update=true\n');
    assert.equal(readFileSync(summary, 'utf8'), `${line}\n`);
    assert.deepEqual(lines, [line]);
    assert.ok(tokens.length === 2 && tokens.every((token) => token.endsWith('job-token')));
  });

  it('writes update=false once the pull request moved in this slot', async () => {
    const moved = { ...OLD, [COMMIT]: { commit: { committer: { date: '2026-11-22T07:02:00Z' } } } };
    assert.equal(await run({ GITHUB_EVENT_NAME: 'schedule' }, minutesAfter(30), moved), 0);
    assert.equal(readFileSync(output, 'utf8'), 'update=false\n');
  });

  it('reads nothing from GitHub on a run by hand', async () => {
    assert.equal(await run({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, minutesAfter(2), {}), 0);
    assert.equal(readFileSync(output, 'utf8'), 'update=true\n');
    assert.deepEqual(tokens, []);
  });

  it('throws naming a missing value, writing no output', async () => {
    await assert.rejects(run({ GITHUB_EVENT_NAME: undefined }, minutesAfter(2)), /GITHUB_EVENT_NAME is not set/);
    await assert.rejects(run({ GITHUB_EVENT_NAME: 'push', GITHUB_TOKEN: undefined }, minutesAfter(2)), /GITHUB_TOKEN is not set/);
    assert.equal(readFileSync(output, 'utf8'), '');
  });

  it('throws for a repository with no release pull request', async () => {
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 't', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GITHUB_EVENT_NAME: 'push' };
    const profiles = new Map([[REPO, { ...PROFILE, release: null }]]);
    await assert.rejects(pullUpdateCommand(env, { profiles, fetchFn: fetchOf(OLD), channels: CHANNELS, now: minutesAfter(2), out: () => undefined }), /names no release pull request for acme\/tool/);
  });
});
