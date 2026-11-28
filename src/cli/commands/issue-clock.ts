import type { KitConfig } from '../../config/types.ts';
import { SecretScanner } from '../../core/secrets.ts';
import { formatClocks, issueThread, pullThread, remindersText, stepClocks, type Clock, type MarkPost, type Thread } from '../../sync/clock.ts';
import type { Clocked } from '../../issues/host.ts';
import { issueOwner, issueRef, type ImportRules } from '../../sync/map.ts';
import type { OurLogins } from '../../sync/trust.ts';
import { postLine } from '../../inbox/inbox.ts';
import type { HostIssue } from '../../issues/issue.ts';
import type { HostPull } from '../../issues/pull.ts';
import { GITHUB_ACTOR } from '../../register/policy.ts';
import type { Task } from '../../register/fold.ts';
import { fileLockOf } from '../file-locks.ts';
import { teamZone, type Kit } from '../kit.ts';
import type { CliRuntime } from '../runtime.ts';
import { inboxDepsOf } from './inbox.ts';
import { githubState } from '../github-state.ts';
import { readReplies } from '../replies-state.ts';

/**
 * The response clock's part of a sync that writes (T3028, sync/clock.ts): from each repository it read, the open
 * threads (issues and pull requests) and who answers each, then the clocks kept in the team's replies file under the sync's lock, and one unwoken inbox
 * line to each owner whose thread reached 75% of its answer target. GH-LATE at 100% is `check`'s (issue-clock-check.ts).
 */

/** How the response clock reads a tracker's posts: by its marking, or not at all, with the line a writing sync says. */
export type ClockMarking = { readonly kind: 'marks'; readonly mark: MarkPost } | { readonly kind: 'off'; readonly line: string };

/**
 * The response clock's reading of `tracker`'s posts, with the team's logins `ours` bound (issues/host.ts PostMarks).
 * A tracker without `clocks` cannot tell the team's posts from others', so the clock times none of its threads and
 * keeps every clock it holds as it was.
 */
export function clockMarking(tracker: Clocked & { readonly name: string }, ours: OurLogins): ClockMarking {
  const marks = tracker.clocks;
  if (marks === undefined) {
    return { kind: 'off', line: `OFF response clock: ${tracker.name} cannot tell the team's posts from others', so no thread's wait is timed` };
  }
  return { kind: 'marks', mark: (post) => marks.markPost(post, ours) };
}

/**
 * The open issues of one repository of `tracker` read as threads: one a task tracks is held and answered by that task's owner, any
 * other by the import's owner rule. Each post is what `mark`, the tracker's marking (clockMarking), makes it.
 */
export function repoThreads(tracker: string, issues: readonly HostIssue[], tasks: readonly Task[], rules: ImportRules, mark: MarkPost): Thread[] {
  const holders = new Map<string, string>();
  for (const task of tasks) {
    if (task.ref !== null && !holders.has(task.ref)) {
      holders.set(task.ref, task.owner);
    }
  }
  return issues.flatMap((issue) => {
    const ref = issueRef(issue.repo, issue.number);
    const holder = holders.get(ref);
    return issueThread(tracker, issue, ref, holder ?? issueOwner(issue, rules), holder !== undefined, mark) ?? [];
  });
}

/**
 * The open pull requests of one repository of `tracker` read as `pull` threads, each once, answered by whom its news goes to: the
 * owner of the task one of our own branches names, else `watcher` (sync/pull-news.ts pullRecipient). Give it the
 * open read's pull requests: only that read carries their posts (adapters/connectors/github/queries.ts).
 */
export function pullThreads(tracker: string, pulls: readonly HostPull[], recipientOf: (pull: HostPull) => string, mark: MarkPost): Thread[] {
  const seen = new Set<string>();
  return pulls.flatMap((pull) => {
    const ref = issueRef(pull.repo, pull.number);
    if (seen.has(ref)) {
      return [];
    }
    seen.add(ref);
    return pullThread(tracker, pull, ref, recipientOf(pull), mark) ?? [];
  });
}

/**
 * Steps the clocks over the repositories in `read` and posts the reminders due now, unwoken: one line per owner,
 * naming its count and first few when several fall due at once (#1475). Gives one line per owner reminded and per
 * one the inbox refused.
 */
export async function recordClocks(runtime: CliRuntime, kit: Kit, config: KitConfig, read: ReadonlySet<string>, threads: readonly Thread[]): Promise<string[]> {
  const now = runtime.clock.now();
  const remind = await fileLockOf(runtime, githubState(kit.paths).syncLock, config.lock).run(async (): Promise<readonly Clock[]> => {
    const step = stepClocks(await readReplies(runtime.files, kit.paths), read, threads, now, config.replies.targetHours);
    await runtime.files.write(kit.paths.replies, formatClocks(step.clocks));
    return step.remind;
  });
  const inboxes = inboxDepsOf(runtime, kit.paths).inboxes;
  const secrets = new SecretScanner(config.register.secretPatterns);
  const zone = teamZone(config, runtime);
  const lines: string[] = [];
  const byOwner = new Map<string, Clock[]>();
  for (const clock of remind) {
    byOwner.set(clock.owner, [...(byOwner.get(clock.owner) ?? []), clock]);
  }
  for (const [owner, clocks] of byOwner) {
    const problem = await postLine(inboxes, secrets, { to: owner, from: GITHUB_ACTOR, text: remindersText(clocks, now, zone, config.replies.targetHours), now: new Date(now) });
    const what = clocks.length === 1 ? `${clocks[0]?.ref} waits` : `${clocks.length} GitHub threads wait`;
    lines.push(problem === undefined ? `REMINDED ${owner}: ${what} on an answer` : `INBOX ${owner}: not posted: ${problem}`);
  }
  return lines;
}
