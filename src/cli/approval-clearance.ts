import { reviewPathMatcher } from '../push-guard/review-paths.ts';
import { answerNamesHead, approvedTaskOf } from '../register/approval.ts';
import type { Task } from '../register/fold.ts';
import type { MergeStanding } from './ship-approval.ts';

/**
 * Whether a merge may go ahead (T2788, security verdict on T2763): refused with why; the caller's own say (a root
 * team's lead, whom nobody approves); the approval of `by`, one of the caller's leaders, given in the register; or
 * `low-risk` (owner order, T3448): the answerer `by` approved the head itself, and none of its `paths` is
 * sensitive. Shared by the ship tool's merge and `teamrig pr`, which lands an outside pull request.
 */
export type MergeClearance =
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'self' }
  | { readonly kind: 'approved'; readonly by: string }
  | { readonly kind: 'low-risk'; readonly by: string; readonly paths: number };

/** How a merge that may go ahead was cleared, as its log line says it. */
export function clearanceText(clearance: Exclude<MergeClearance, { kind: 'refused' }>): string {
  switch (clearance.kind) {
    case 'self':
      return "the caller's own, a root team's lead";
    case 'approved':
      return `approved by ${clearance.by}`;
    case 'low-risk':
      return `low-risk, approved by ${clearance.by}, the answerer: ${clearance.paths} changed path(s), none sensitive`;
  }
}

/** How many sensitive paths a refusal names before it counts the rest. */
const NAMED_PATHS = 5;

/** A refused clearance, with why. */
export const refusedClearance = (reason: string): MergeClearance => ({ kind: 'refused', reason });

/** What the answerer's head touches (T3448): how many paths, the sensitive ones, and the other sessions' open branches it overlaps. */
export interface AnswererChange {
  readonly paths: number;
  readonly sensitive: readonly string[];
  readonly overlaps: readonly Overlap[];
}

/**
 * The answerer's clearance of its own head, which no leader approved (owner order, T3448): alone, by its own
 * `--approved`, when the head touches no sensitive path and no file another session's open branch changes; else the
 * one session that must approve the head first, the security reviewer for a sensitive path or the session whose open
 * branch it overlaps, by an approval naming the head. Several such sessions, or a sensitive path in a team with no
 * other security reviewer, are the leaders' to approve: a task holds one answer at a time. `namesHead` tells whether
 * that approval names the head: a prefix for the ship tool's own branches, all 40 hex digits for `teamrig pr`, whose
 * outside author picks the commits (T4958 C1).
 */
export function answererClearance(
  standing: Pick<MergeStanding, 'caller' | 'securityReviewer'>,
  task: Task,
  head: string,
  unapproved: string,
  change: AnswererChange,
  namesHead: (task: Pick<Task, 'answer'>, head: string) => boolean = answerNamesHead,
): MergeClearance {
  const { caller, securityReviewer } = standing;
  const { sensitive, overlaps } = change;
  const sensitiveText = `the sensitive ${pathsText(sensitive)}`;
  if (overlaps.length > 1) {
    return refusedClearance(`${unapproved}; it touches files of several sessions' open branches (${overlaps.map(overlapText).join('; ')}), which the leaders approve`);
  }
  if (sensitive.length > 0 && (securityReviewer === undefined || securityReviewer === caller)) {
    return refusedClearance(`${unapproved}; it touches ${sensitiveText}, and the team has no other security reviewer to pass it first`);
  }
  const needs = [
    ...(sensitive.length > 0 && securityReviewer !== undefined ? [{ who: securityReviewer, why: sensitiveText }] : []),
    ...overlaps.map((overlap) => ({ who: overlap.owner, why: overlapText(overlap) })),
  ];
  const [first, ...rest] = needs;
  if (first === undefined) {
    return { kind: 'low-risk', by: caller, paths: change.paths };
  }
  if (rest.some((need) => need.who !== first.who)) {
    return refusedClearance(`${unapproved}; it touches ${needs.map((need) => need.why).join(' and ')}, which the leaders approve`);
  }
  const answered = approvedTaskOf([task], caller, [first.who]);
  if (answered !== undefined && namesHead(task, head)) {
    return { kind: 'approved', by: answered.by };
  }
  const why = needs.map((need) => need.why).join(' and ');
  return refusedClearance(`${task.id} touches ${why}: set it waiting approval:${first.who} and ask ${first.who} to approve it naming ${head} (a leader's approval of it clears it too)`);
}

/** Paths in a refusal: the first five, then a count of the rest. */
function pathsText(paths: readonly string[]): string {
  const more = paths.length > NAMED_PATHS ? ` and ${paths.length - NAMED_PATHS} more` : '';
  return `${paths.slice(0, NAMED_PATHS).join(', ')}${more}`;
}

function overlapText(overlap: Overlap): string {
  return `${pathsText(overlap.paths)}, which ${overlap.owner}'s open ${overlap.tasks.join(', ')} change${overlap.tasks.length > 1 ? '' : 's'}`;
}

/** A branch of another session's open task, and the paths it changes over main. */
export interface OpenBranch {
  readonly task: string;
  readonly owner: string;
  readonly paths: readonly string[];
}

/** The paths of the head that one other session's open branches change too, and those branches' tasks. */
export interface Overlap {
  readonly owner: string;
  readonly tasks: readonly string[];
  readonly paths: readonly string[];
}

/** The head's `paths` that `branches` change too, one entry per owner in branch order, its tasks and paths each once. */
export function overlapsOf(paths: readonly string[], branches: readonly OpenBranch[]): readonly Overlap[] {
  const head = new Set(paths);
  const byOwner = new Map<string, { tasks: Set<string>; paths: Set<string> }>();
  for (const branch of branches) {
    const shared = branch.paths.filter((path) => head.has(path));
    if (shared.length === 0) {
      continue;
    }
    const entry = byOwner.get(branch.owner) ?? { tasks: new Set<string>(), paths: new Set<string>() };
    entry.tasks.add(branch.task);
    shared.forEach((path) => entry.paths.add(path));
    byOwner.set(branch.owner, entry);
  }
  return [...byOwner].map(([owner, entry]) => ({ owner, tasks: [...entry.tasks], paths: [...entry.paths] }));
}

/**
 * The sensitive paths among `paths` (T3448, security verdict): each that matches no low-risk glob, or matches a sensitive
 * one, read as the review gate reads its entries (`reviewPathMatcher`). An allow list, so a path nobody listed is
 * sensitive; the sensitive globs carve out of it what no team's low-risk folder may clear.
 */
export function sensitivePathsOf(paths: readonly string[], globs: Pick<MergeStanding, 'lowRisk' | 'sensitive'>): readonly string[] {
  const lowRisk = globs.lowRisk.map(reviewPathMatcher);
  const sensitive = globs.sensitive.map(reviewPathMatcher);
  return paths.filter((path) => !lowRisk.some((matches) => matches(path)) || sensitive.some((matches) => matches(path)));
}
