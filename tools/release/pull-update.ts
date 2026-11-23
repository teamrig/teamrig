import { appendFileSync } from 'node:fs';
import { EXIT_CLEAN } from '../lib/exit.ts';
import { clockText, currentSlot, slotStart, type Channels } from './channels.ts';
import type { Env } from './release-merge-commands.ts';

/**
 * Whether a run of .github/workflows/release.yml may open or update the release pull request (T5186). Each update
 * rewrites the pull request's head, which starts its ci over; when every push to main updated it, a busy main kept the
 * release from ever finishing a ci run. So a push to main only tags and publishes a release that merged, and the pull
 * request moves once per preview slot (tools/release/channels.json): on the hourly run inside the slot's first hour, or
 * on a run by hand. Between those it stays still, its ci finishes once, and release-merge.yml merges it.
 */

/** How long after a slot starts the hourly run still updates the pull request: one hour, so one run per slot does. */
export const UPDATE_WINDOW_MINUTES = 60;

export interface PullUpdate {
  readonly update: boolean;
  readonly reason: string;
}

export function pullUpdate(event: string, now: Date, channels: Channels): PullUpdate {
  if (event === 'workflow_dispatch') return { update: true, reason: 'a run by hand updates the release pull request' };
  if (event === 'push') return { update: false, reason: 'a push to main only tags a merged release; the release pull request moves at a slot start' };
  if (event !== 'schedule') throw new Error(`release.yml runs on push, schedule or workflow_dispatch, not ${event}`);
  const slot = clockText(currentSlot(now, channels));
  const since = Math.floor((now.getTime() - slotStart(now, channels).getTime()) / 60_000);
  if (since < UPDATE_WINDOW_MINUTES) return { update: true, reason: `the ${slot} slot started ${since} min ago: the release pull request takes main's commits` };
  return { update: false, reason: `the ${slot} slot started ${since} min ago: the release pull request stays as it is until the next slot` };
}

function envValue(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

export interface PullUpdateDeps {
  readonly channels: Channels;
  readonly now: Date;
  readonly out: (line: string) => void;
}

/** Writes `update=true|false` to GITHUB_OUTPUT and the reason to the step summary; a missing value throws. */
export function pullUpdateCommand(env: Env, deps: PullUpdateDeps): number {
  const event = envValue(env, 'GITHUB_EVENT_NAME');
  const output = envValue(env, 'GITHUB_OUTPUT');
  const summaryFile = envValue(env, 'GITHUB_STEP_SUMMARY');
  const decision = pullUpdate(event, deps.now, deps.channels);
  const summary = `Release pull request: ${decision.update ? 'updates' : 'no update'}: ${decision.reason}\n`;
  appendFileSync(summaryFile, summary);
  deps.out(summary.trimEnd());
  appendFileSync(output, `update=${decision.update}\n`);
  return EXIT_CLEAN;
}
