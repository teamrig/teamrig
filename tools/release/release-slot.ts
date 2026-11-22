import { appendFileSync } from 'node:fs';
import { isRecord } from '../lib/guards.ts';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { profileFor, type RepoProfile } from '../ship/repos.ts';
import { clockText, currentSlot, slotHold, slotStart, type Channels } from './channels.ts';
import { codeSpan, fetchGitHubApi, lastMergeOf, releasePulls, type Fetch, type ReleaseBranch, type RepoGet } from './release-merge.ts';
import type { Env } from './release-merge-commands.ts';

/**
 * The hourly nudge of the release clock (T5133), run by .github/workflows/release-slot.yml with its read-only token.
 * A release pull request held in one slot gets no new ci run when main stays quiet, so nothing would start the release
 * merge gate in the next slot. Each hour this says whether to run ci on the release branch now: only when a release
 * pull request is open, no release merged in this slot yet, and ci has not already been started on its head in this
 * slot. The workflow then runs ci, and release-merge.yml's gate decides on its end as for any other run.
 * Writes `dispatch=true|false` and, on true, `ref=<release branch>` to GITHUB_OUTPUT; exit 0, or 1 when GitHub shows
 * more than one open release pull request. A missing or malformed value throws.
 */

export interface SlotCommandDeps {
  readonly profiles: ReadonlyMap<string, RepoProfile>;
  readonly fetchFn: Fetch;
  readonly channels: Channels;
  readonly now: Date;
  readonly out: (line: string) => void;
}

/** ci's file name, which release.yml runs on the release branch too. */
export const CI_WORKFLOW = 'ci.yml';

export type SlotDecision = { readonly dispatch: true; readonly reason: string } | { readonly dispatch: false; readonly reason: string; readonly odd: boolean };

function envValue(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

/** The head sha of the one open release pull request's list entry. */
function headSha(pull: unknown): string {
  const head = isRecord(pull) ? pull['head'] : undefined;
  const sha = isRecord(head) ? head['sha'] : undefined;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error("GitHub's pull list[0].head.sha is not a commit sha");
  return sha;
}

/** When ci was last started by hand on `sha`, read from its newest dispatched run on the release branch, or null. */
async function ciStartedOn(get: RepoGet, branch: ReleaseBranch, sha: string): Promise<Date | null> {
  const runs = await get(`/actions/workflows/${CI_WORKFLOW}/runs?branch=${encodeURIComponent(branch.head)}&event=workflow_dispatch&per_page=1`);
  const list = isRecord(runs) ? runs['workflow_runs'] : undefined;
  if (!Array.isArray(list)) throw new Error("GitHub's workflow run list is not a list");
  const [newest]: unknown[] = list;
  if (!isRecord(newest) || newest['head_sha'] !== sha) return null;
  const created = newest['created_at'];
  const at = typeof created === 'string' ? new Date(created) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new Error("GitHub's workflow run created_at is not a time");
  return at;
}

export async function slotDecision(get: RepoGet, branch: ReleaseBranch, channels: Channels, now: Date): Promise<SlotDecision> {
  const open = await releasePulls(get, branch, 'open');
  const [pull] = open;
  if (pull === undefined) return { dispatch: false, reason: 'no release pull request is open', odd: false };
  if (open.length > 1) return { dispatch: false, reason: `${open.length} open pull requests come from the release branch`, odd: true };
  const hold = slotHold(now, lastMergeOf(await releasePulls(get, branch, 'closed')), channels);
  if (hold !== null) return { dispatch: false, reason: hold, odd: false };
  const sha = headSha(pull);
  const started = await ciStartedOn(get, branch, sha);
  const slot = clockText(currentSlot(now, channels));
  if (started !== null && started.getTime() >= slotStart(now, channels).getTime()) {
    return { dispatch: false, reason: `ci already started on ${codeSpan(sha)} in the ${slot} slot: its end decides`, odd: false };
  }
  return { dispatch: true, reason: `ci runs on ${codeSpan(sha)} for the ${slot} slot` };
}

export async function slotCommand(env: Env, deps: SlotCommandDeps): Promise<number> {
  const repo = envValue(env, 'GITHUB_REPOSITORY');
  const token = envValue(env, 'GITHUB_TOKEN');
  const output = envValue(env, 'GITHUB_OUTPUT');
  const summaryFile = envValue(env, 'GITHUB_STEP_SUMMARY');
  const profile = profileFor(deps.profiles, repo);
  if (profile.release === null) throw new Error(`repos.json names no release pull request for ${repo}`);
  const branch: ReleaseBranch = { repo, main: profile.main, head: profile.release.head };
  const api = fetchGitHubApi(deps.fetchFn, env['GITHUB_API_URL'] || undefined);
  const get: RepoGet = (path) => api({ method: 'GET', path: `/repos/${repo}${path}`, token });
  const decision = await slotDecision(get, branch, deps.channels, deps.now);
  const summary = `Release slot: ${decision.dispatch ? '' : 'no ci run: '}${decision.reason}\n`;
  appendFileSync(summaryFile, summary);
  deps.out(summary.trimEnd());
  appendFileSync(output, decision.dispatch ? `dispatch=true\nref=${branch.head}\n` : 'dispatch=false\n');
  return !decision.dispatch && decision.odd ? EXIT_FINDINGS : EXIT_CLEAN;
}
