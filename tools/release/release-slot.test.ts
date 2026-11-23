import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { profileFor, readProfiles, type RepoProfile } from '../ship/repos.ts';
import { parseChannels } from './channels.ts';
import type { Fetch } from './release-merge.ts';
import { slotCommand, slotDecision } from './release-slot.ts';

const REPO = 'acme/tool';
const HEAD = 'release-please--branches--main';
const SHA = 'a'.repeat(40);
const BRANCH = { repo: REPO, main: 'main', head: HEAD };
const CHANNELS = parseChannels(JSON.stringify({ zone: 'Asia/Jerusalem', previewSlots: ['09:00', '12:00', '21:00'], stableAt: '20:00', soakHours: 3 }));
/** 09:30 in Asia/Jerusalem, winter time: inside the 09:00 slot, which started 07:00 UTC. */
const NOW = new Date('2026-11-22T07:30:00Z');

const OPEN = `/pulls?state=open&base=main&head=${encodeURIComponent(`acme:${HEAD}`)}&per_page=100`;
const CLOSED = `/pulls?state=closed&base=main&head=${encodeURIComponent(`acme:${HEAD}`)}&sort=updated&direction=desc&per_page=100`;
const RUNS = `/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(HEAD)}&event=workflow_dispatch&per_page=1`;

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

const quiet = (over: Readonly<Record<string, unknown>> = {}) =>
  reader({
    [OPEN]: [{ number: 12, head: { sha: SHA } }],
    [CLOSED]: [{ number: 11, merged_at: '2026-11-21T19:30:00Z' }],
    [RUNS]: { workflow_runs: [{ head_sha: SHA, created_at: '2026-11-21T20:00:00Z' }] },
    ...over,
  });

describe('slotDecision', () => {
  it('runs ci on the held head once a new slot starts', async () => {
    assert.deepEqual(await slotDecision(quiet().get, BRANCH, CHANNELS, NOW), { dispatch: true, reason: `ci runs on \`${SHA}\` for the 09:00 slot` });
  });

  it('runs ci when ci last ran on another head, or never', async () => {
    assert.equal((await slotDecision(quiet({ [RUNS]: { workflow_runs: [{ head_sha: 'b'.repeat(40), created_at: '2026-11-22T07:10:00Z' }] } }).get, BRANCH, CHANNELS, NOW)).dispatch, true);
    assert.equal((await slotDecision(quiet({ [RUNS]: { workflow_runs: [] } }).get, BRANCH, CHANNELS, NOW)).dispatch, true);
  });

  it('runs nothing with no release pull request open, and reads no further', async () => {
    const fake = quiet({ [OPEN]: [] });
    assert.deepEqual(await slotDecision(fake.get, BRANCH, CHANNELS, NOW), { dispatch: false, reason: 'no release pull request is open', odd: false });
    assert.deepEqual(fake.read, [OPEN]);
  });

  it('runs nothing, as odd, with two open release pull requests', async () => {
    assert.deepEqual(await slotDecision(quiet({ [OPEN]: [{ number: 12 }, { number: 13 }] }).get, BRANCH, CHANNELS, NOW), {
      dispatch: false,
      reason: '2 open pull requests come from the release branch',
      odd: true,
    });
  });

  it('runs nothing once a release merged in this slot', async () => {
    const decision = await slotDecision(quiet({ [CLOSED]: [{ number: 11, merged_at: '2026-11-22T07:05:00Z' }] }).get, BRANCH, CHANNELS, NOW);
    assert.deepEqual(decision, { dispatch: false, reason: 'a preview release already merged in the 09:00 slot: the next starts at 12:00 Asia/Jerusalem', odd: false });
  });

  it('runs nothing when ci already started on this head in this slot', async () => {
    const decision = await slotDecision(quiet({ [RUNS]: { workflow_runs: [{ head_sha: SHA, created_at: '2026-11-22T07:01:00Z' }] } }).get, BRANCH, CHANNELS, NOW);
    assert.deepEqual(decision, { dispatch: false, reason: `ci already started on \`${SHA}\` in the 09:00 slot: its end decides`, odd: false });
  });

  it('throws on answers of another shape', async () => {
    await assert.rejects(slotDecision(quiet({ [OPEN]: [{ number: 12, head: { sha: 'abc' } }] }).get, BRANCH, CHANNELS, NOW), /head\.sha is not a commit sha/);
    await assert.rejects(slotDecision(quiet({ [RUNS]: {} }).get, BRANCH, CHANNELS, NOW), /workflow run list is not a list/);
    await assert.rejects(slotDecision(quiet({ [RUNS]: { workflow_runs: [{ head_sha: SHA, created_at: 'soon' }] } }).get, BRANCH, CHANNELS, NOW), /created_at is not a time/);
  });
});

describe('slotCommand', () => {
  const PROFILE: RepoProfile = { ...profileFor(readProfiles(), 'teamrig/teamrig'), main: 'main', release: { head: HEAD, changelog: 'CHANGELOG.md' } };
  const PROFILES: ReadonlyMap<string, RepoProfile> = new Map([[REPO, PROFILE]]);
  let dir: string;
  let output: string;
  let summary: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-slot-'));
    output = join(dir, 'output');
    summary = join(dir, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A fetch answering GitHub's paths from a fake reader, recording the token each call carried. */
  const fetchOf = (answers: Readonly<Record<string, unknown>>, tokens: string[]): Fetch => async (url, init) => {
    tokens.push(new Headers(init.headers).get('authorization') ?? '');
    const path = url.replace(`https://api.github.com/repos/${REPO}`, '');
    if (!(path in answers)) return new Response('', { status: 404 });
    return new Response(JSON.stringify(answers[path]), { status: 200 });
  };
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'read-token', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' };

  it('writes dispatch and the release branch, and the reason to the summary', async () => {
    const tokens: string[] = [];
    const printed: string[] = [];
    const answers = {
      [OPEN]: [{ number: 12, head: { sha: SHA } }],
      [CLOSED]: [],
      [RUNS]: { workflow_runs: [] },
    };
    const code = await slotCommand({ ...env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, { profiles: PROFILES, fetchFn: fetchOf(answers, tokens), channels: CHANNELS, now: NOW, out: (line) => printed.push(line) });
    assert.equal(code, 0);
    assert.equal(readFileSync(output, 'utf8'), `dispatch=true\nref=${HEAD}\n`);
    assert.equal(readFileSync(summary, 'utf8'), `Release slot: ci runs on \`${SHA}\` for the 09:00 slot\n`);
    assert.deepEqual(printed, [`Release slot: ci runs on \`${SHA}\` for the 09:00 slot`]);
    assert.ok(tokens.length === 3 && tokens.every((token) => token.endsWith('read-token')));
  });

  it('writes no dispatch, and exits 1 on two open release pull requests', async () => {
    const code = await slotCommand(
      { ...env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
      { profiles: PROFILES, fetchFn: fetchOf({ [OPEN]: [{ number: 12 }, { number: 13 }] }, []), channels: CHANNELS, now: NOW, out: () => undefined },
    );
    assert.equal(code, 1);
    assert.equal(readFileSync(output, 'utf8'), 'dispatch=false\n');
    assert.equal(readFileSync(summary, 'utf8'), 'Release slot: no ci run: 2 open pull requests come from the release branch\n');
  });

  it('throws on a missing value or a repository with no release', async () => {
    const deps = { profiles: PROFILES, fetchFn: fetchOf({}, []), channels: CHANNELS, now: NOW, out: () => undefined };
    await assert.rejects(slotCommand({ ...env, GITHUB_STEP_SUMMARY: summary }, deps), /GITHUB_OUTPUT is not set/);
    await assert.rejects(
      slotCommand({ ...env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, { ...deps, profiles: new Map([[REPO, { ...PROFILE, release: null }]]) }),
      /names no release pull request for acme\/tool/,
    );
  });
});

describe('release slot CLI', () => {
  it('takes no arguments', () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('./release-slot-cli.ts', import.meta.url)), 'extra'], { encoding: 'utf8' });
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /takes no arguments/);
  });
});
