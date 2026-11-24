import { appendFileSync } from 'node:fs';
import { isRecord } from '../lib/guards.ts';
import { EXIT_CLEAN } from '../lib/exit.ts';
import { profileFor, type RepoProfile } from '../ship/repos.ts';
import { clockText, currentSlot, slotStart, type Channels } from './channels.ts';
import { fetchGitHubApi, releasePulls, type Fetch, type ReleaseBranch, type RepoGet } from './release-merge.ts';
import type { Env } from './release-merge-commands.ts';

/**
 * Whether a run of .github/workflows/release.yml may open or update the release pull request (T5186). Each update
 * rewrites the pull request's head, which starts its ci over; when every push to main updated it, a busy main kept the
 * release from ever finishing a ci run. So the pull request moves once per preview slot (tools/release/channels.json):
 * on the first run of any kind, a push or the hourly schedule, that finds its head committed before the slot's start,
 * or on a run by hand. Once it moved, its head is newer than the slot's start and it stays still, its ci finishes once,
 * and release-merge.yml merges it. The decision reads the head's own time, not the run's: GitHub drops and delays
 * scheduled runs, and a gate only the hourly run opened, inside a slot's first hour, left the pull request unmoved
 * for a whole day (T5330).
 */

/** The open release pull request's head, as the gate needs it. */
export type ReleaseHead =
  | { readonly kind: 'none' }
  | { readonly kind: 'one'; readonly committedAt: Date }
  | { readonly kind: 'many'; readonly count: number };

export interface PullUpdate {
  readonly update: boolean;
  readonly reason: string;
}

export function pullUpdate(event: string, now: Date, channels: Channels, head: ReleaseHead): PullUpdate {
  if (event === 'workflow_dispatch') return { update: true, reason: 'a run by hand updates the release pull request' };
  if (event !== 'push' && event !== 'schedule') throw new Error(`release.yml runs on push, schedule or workflow_dispatch, not ${event}`);
  if (head.kind === 'none') return { update: true, reason: 'no release pull request is open: release-please may open one' };
  if (head.kind === 'many') return { update: false, reason: `${head.count} open pull requests come from the release branch: none is moved` };
  const slot = clockText(currentSlot(now, channels));
  if (head.committedAt.getTime() < slotStart(now, channels).getTime()) {
    return { update: true, reason: `the release pull request's head predates the ${slot} slot: it takes main's commits` };
  }
  return { update: false, reason: `the release pull request already moved in the ${slot} slot: it stays as it is until the next slot` };
}

/** When `sha` was committed, read from GitHub's commit. */
async function committedAt(get: RepoGet, sha: string): Promise<Date> {
  const commit = await get(`/commits/${sha}`);
  const inner = isRecord(commit) ? commit['commit'] : undefined;
  const committer = isRecord(inner) ? inner['committer'] : undefined;
  const date = isRecord(committer) ? committer['date'] : undefined;
  const at = typeof date === 'string' ? new Date(date) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new Error("GitHub's commit.committer.date is not a time");
  return at;
}

/** The open release pull request's head: none, the one with its commit time, or how many when more than one. */
export async function releaseHead(get: RepoGet, branch: ReleaseBranch): Promise<ReleaseHead> {
  const open = await releasePulls(get, branch, 'open');
  const [pull] = open;
  if (pull === undefined) return { kind: 'none' };
  if (open.length > 1) return { kind: 'many', count: open.length };
  const head = pull['head'];
  const sha = isRecord(head) ? head['sha'] : undefined;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error("GitHub's pull list[0].head.sha is not a commit sha");
  return { kind: 'one', committedAt: await committedAt(get, sha) };
}

function envValue(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

export interface PullUpdateDeps {
  readonly profiles: ReadonlyMap<string, RepoProfile>;
  readonly fetchFn: Fetch;
  readonly channels: Channels;
  readonly now: Date;
  readonly out: (line: string) => void;
}

/**
 * Writes `update=true|false` to GITHUB_OUTPUT and the reason to the step summary; a missing value throws. A run by
 * hand reads nothing from GitHub; any other run reads the open release pull request with the job's token.
 */
export async function pullUpdateCommand(env: Env, deps: PullUpdateDeps): Promise<number> {
  const event = envValue(env, 'GITHUB_EVENT_NAME');
  const output = envValue(env, 'GITHUB_OUTPUT');
  const summaryFile = envValue(env, 'GITHUB_STEP_SUMMARY');
  let head: ReleaseHead = { kind: 'none' };
  if (event !== 'workflow_dispatch') {
    const repo = envValue(env, 'GITHUB_REPOSITORY');
    const token = envValue(env, 'GITHUB_TOKEN');
    const profile = profileFor(deps.profiles, repo);
    if (profile.release === null) throw new Error(`repos.json names no release pull request for ${repo}`);
    const api = fetchGitHubApi(deps.fetchFn, env['GITHUB_API_URL'] || undefined);
    const get: RepoGet = (path) => api({ method: 'GET', path: `/repos/${repo}${path}`, token });
    head = await releaseHead(get, { repo, main: profile.main, head: profile.release.head });
  }
  const decision = pullUpdate(event, deps.now, deps.channels, head);
  const summary = `Release pull request: ${decision.update ? 'updates' : 'no update'}: ${decision.reason}\n`;
  appendFileSync(summaryFile, summary);
  deps.out(summary.trimEnd());
  appendFileSync(output, `update=${decision.update}\n`);
  return EXIT_CLEAN;
}
