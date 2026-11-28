/**
 * The response clock on a tracker's threads (T3021 section 4, slice E; tracker-neutral since T5796): how long an outsider has waited for an answer of
 * ours in words, against the team's target per kind of thread [replies.targetHours]. Code keeps it at 0 tokens: at
 * REMIND_SHARE of the target the owning session gets one unwoken inbox line, at the target `teamrig check` raises
 * GH-LATE for the lead. Pure: the sync reads the threads and keeps the clocks in their own state file
 * (src/cli/commands/issue-clock.ts, src/cli/replies-state.ts). The targets are read at each step, not kept on a clock, so a changed target
 * moves the clocks already running.
 */

import type { ReplyTargetHours } from '../config/types.ts';
import { isRecord } from '../core/guards.ts';
import { parseObject, toJsonlLine, VERSION_FIELD } from '../core/jsonl.ts';
import type { TimeZone } from '../core/zone.ts';
import type { HostIssue, IssueComment } from '../issues/issue.ts';
import type { HostPull } from '../issues/pull.ts';
import { isInsideAuthor, isOurAuthor, type OurLogins } from './trust.ts';

/** The kinds of thread, each with its own answer target. */
export const THREAD_KINDS = ['security', 'bug', 'pull', 'comment', 'feature'] as const;

export type ThreadKind = (typeof THREAD_KINDS)[number];

const HOUR_MS = 3_600_000;

/** The share of its target a thread waits before its owner is reminded, once. */
export const REMIND_SHARE = 0.75;

/** One post on a thread, its opening post too: when, who, and whether we wrote it. A bot's post is none: it neither starts nor stops a clock. */
export interface ThreadPost {
  readonly at: number;
  readonly ours: boolean;
  /** Its author's login on the tracker. */
  readonly login: string;
}

/** An open thread as one read saw it. */
export interface Thread {
  /** The connector that read it, such as `github`. */
  readonly tracker: string;
  /** `owner/name`. */
  readonly repo: string;
  /** As the task list names it (sync/map.ts issueRef). */
  readonly ref: string;
  readonly kind: ThreadKind;
  /** The session that answers it. */
  readonly owner: string;
  /** As the tracker has it, outside input. */
  readonly title: string;
  readonly posts: readonly ThreadPost[];
}

/** A running clock: the thread has waited since `since` for an answer of ours. */
export interface Clock {
  readonly tracker: string;
  readonly repo: string;
  readonly ref: string;
  readonly kind: ThreadKind;
  readonly owner: string;
  readonly title: string;
  /** The login of the post the wait started at. */
  readonly author: string;
  /** The person of ours the thread is assigned to, empty for none. */
  readonly assignedTo: string;
  readonly since: number;
  /** When its owner was reminded; undefined until then. */
  readonly remindedAt: number | undefined;
}

/**
 * When the thread started waiting on us: its oldest outside post after our newest one, or undefined when we spoke
 * last or no outsider posted. The oldest, not the newest: a "any news?" follow-up must not restart the wait.
 */
export function waitingSince(posts: readonly ThreadPost[]): number | undefined {
  return waitingPost(posts)?.at;
}

/** The post waitingSince starts at, so its author is named too. */
function waitingPost(posts: readonly ThreadPost[]): ThreadPost | undefined {
  const ordered = [...posts].sort((a, b) => a.at - b.at);
  const lastOurs = ordered.findLastIndex((post) => post.ours);
  return ordered.slice(lastOurs + 1).find((post) => !post.ours);
}

/** A clock's target in milliseconds. */
export function targetMs(kind: ThreadKind, targets: ReplyTargetHours): number {
  return targets[kind] * HOUR_MS;
}

/** Whether a clock passed its target at `now`. */
export function isLate(clock: Pick<Clock, 'kind' | 'since'>, now: number, targets: ReplyTargetHours): boolean {
  return now - clock.since >= targetMs(clock.kind, targets);
}

/** What one sync's read does to the clocks: the clocks kept, and those whose owner is reminded now. */
export interface ClockStep {
  readonly clocks: ReadonlyMap<string, Clock>;
  readonly remind: readonly Clock[];
}

/**
 * The clocks after a read of the repositories in `read`: each open thread waiting on us keeps its clock (and whether
 * it was reminded) while the wait it times is the same one, else starts a fresh one; a thread answered, closed or
 * gone stops its clock. A repository not read this time (it failed) keeps its clocks as they were. A clock past
 * REMIND_SHARE of its target that was never reminded is reminded now, once. Whom it is assigned to is kept.
 */
export function stepClocks(before: ReadonlyMap<string, Clock>, read: ReadonlySet<string>, threads: readonly Thread[], now: number, targets: ReplyTargetHours): ClockStep {
  const clocks = new Map([...before].filter(([, clock]) => !read.has(clock.repo)));
  const remind: Clock[] = [];
  for (const thread of threads) {
    const waiting = waitingPost(thread.posts);
    if (waiting === undefined) {
      continue;
    }
    const since = waiting.at;
    const kept = before.get(thread.ref);
    const remindedAt = kept?.since === since ? kept.remindedAt : undefined;
    const { tracker, repo, ref, kind, owner, title } = thread;
    const clock: Clock = { tracker, repo, ref, kind, owner, title, author: waiting.login, assignedTo: kept?.assignedTo ?? '', since, remindedAt };
    if (clock.remindedAt === undefined && now - since >= targetMs(clock.kind, targets) * REMIND_SHARE) {
      const reminded = { ...clock, remindedAt: now };
      remind.push(reminded);
      clocks.set(thread.ref, reminded);
    } else {
      clocks.set(thread.ref, clock);
    }
  }
  return { clocks, remind };
}

/**
 * An open issue as a thread: its opening post and its comments read, a bot's left out, each ours by postIsOurs; `owner`
 * answers it. Its kind by label (`security`, then `bug`, matched without case), else a comment on a thread we hold
 * (`held`: a task of ours tracks it), else a feature ask or question. Undefined for a closed one.
 */
export function issueThread(tracker: string, issue: HostIssue, ref: string, owner: string, held: boolean, ours: OurLogins): Thread | undefined {
  if (issue.state !== 'open') {
    return undefined;
  }
  const opening = issue.createdAt === undefined ? [] : [{ at: issue.createdAt, login: issue.author, authorAssociation: issue.authorAssociation, authorKind: issue.authorKind }];
  return { tracker, repo: issue.repo, ref, kind: issueKind(issue.labels, held), owner, title: issue.title, posts: threadPosts([...opening, ...issue.comments], ours) };
}

/**
 * An open pull request as a `pull` thread: its opening and its comments and reviews read, a bot's left out, each ours
 * by postIsOurs, as on an issue; `owner` answers it. Undefined for a merged or closed one, and for a draft: it asks
 * nobody to look yet, so its wait starts once it is marked ready.
 */
export function pullThread(tracker: string, pull: HostPull, ref: string, owner: string, ours: OurLogins): Thread | undefined {
  if (pull.state !== 'open' || pull.draft) {
    return undefined;
  }
  const opening = { at: pull.createdAt, login: pull.author, authorAssociation: pull.authorAssociation, authorKind: pull.authorKind };
  return { tracker, repo: pull.repo, ref, kind: 'pull', owner, title: pull.title, posts: threadPosts([opening, ...pull.posts], ours) };
}

/**
 * Whether a post is the team's answer. With `github.owners` naming the team's people, only their logins and the
 * repository's owner answer (isOurAuthor): an outside contributor given collaborator access still waits on us, and
 * their follow-up is no answer. A team that named no one falls back to the author's tie to the repository
 * (isInsideAuthor).
 */
export function postIsOurs(association: string, login: string, ours: OurLogins): boolean {
  return ours.size === 0 ? isInsideAuthor(association) : isOurAuthor(association, login, ours);
}

/** An app's or a workflow's account kind: its posts are no one's answer and no one's ask. */
const BOT = 'Bot';

/** A thread's posts with a bot's left out, each ours by postIsOurs. */
function threadPosts(posts: readonly IssueComment[], ours: OurLogins): ThreadPost[] {
  return posts.filter((post) => post.authorKind !== BOT).map((post) => ({ at: Date.parse(post.at), ours: postIsOurs(post.authorAssociation, post.login, ours), login: post.login }));
}

function issueKind(labels: readonly string[], held: boolean): ThreadKind {
  const has = (name: string): boolean => labels.some((label) => label.toLowerCase() === name);
  if (has('security')) {
    return 'security';
  }
  if (has('bug')) {
    return 'bug';
  }
  return held ? 'comment' : 'feature';
}

/**
 * The format of the replies file this code writes: 2, each row naming its tracker, title, waiting author and
 * assignee (T5796). Format 1 was GitHub's clocks file: its rows read as GitHub's with those left empty, so an upgrade
 * keeps every running clock. A file in another format, or damaged, reads as no clock running.
 */
export const CLOCK_STATE_FORMAT = 2;

/** The only tracker format 1 ever kept clocks for. */
const FORMAT_1_TRACKER = 'github';

/** The clocks a file holds by ref; a damaged entry is left out, a damaged file reads as none. */
export function parseClocks(text: string): Map<string, Clock> {
  const record = parseObject(text.trim());
  const format = record?.[VERSION_FIELD];
  const list = format === 1 || format === CLOCK_STATE_FORMAT ? record?.['clocks'] : undefined;
  const clocks = Array.isArray(list) ? list.flatMap((value) => clockOf(value, format === 1)) : [];
  return new Map(clocks.map((clock) => [clock.ref, clock]));
}

function clockOf(value: unknown, formatOne: boolean): Clock[] {
  if (!isRecord(value)) {
    return [];
  }
  const { repo, ref, kind, owner, since, remindedAt } = value;
  const time = (at: unknown): at is number => typeof at === 'number' && Number.isFinite(at);
  if (typeof repo !== 'string' || typeof ref !== 'string' || typeof owner !== 'string' || !isThreadKind(kind) || !time(since)) {
    return [];
  }
  const text = (field: string): string | undefined => {
    const found = value[field];
    return typeof found === 'string' ? found : undefined;
  };
  const tracker = formatOne ? FORMAT_1_TRACKER : text('tracker');
  const title = formatOne ? '' : text('title');
  const author = formatOne ? '' : text('author');
  const assignedTo = formatOne ? '' : text('assignedTo');
  if (tracker === undefined || title === undefined || author === undefined || assignedTo === undefined) {
    return [];
  }
  return [{ tracker, repo, ref, kind, owner, title, author, assignedTo, since, remindedAt: time(remindedAt) ? remindedAt : undefined }];
}

function isThreadKind(value: unknown): value is ThreadKind {
  return THREAD_KINDS.some((kind) => kind === value);
}

export function formatClocks(clocks: ReadonlyMap<string, Clock>): string {
  return toJsonlLine({
    [VERSION_FIELD]: CLOCK_STATE_FORMAT,
    clocks: [...clocks.values()].map(({ tracker, repo, ref, kind, owner, title, author, assignedTo, since, remindedAt }) => ({
      tracker,
      repo,
      ref,
      kind,
      owner,
      title,
      author,
      assignedTo,
      since,
      ...(remindedAt === undefined ? {} : { remindedAt }),
    })),
  });
}

/** How long a clock has run, in whole hours. */
function waitedHours(clock: Pick<Clock, 'since'>, now: number): number {
  return Math.floor((now - clock.since) / HOUR_MS);
}

/** The owner's unwoken reminder at REMIND_SHARE of the target. */
export function reminderText(clock: Clock, now: number, zone: TimeZone, targets: ReplyTargetHours): string {
  const due = new Date(dueAt(clock, targets));
  return (
    `GitHub ${clock.ref} (${clock.kind}) has waited ${waitedHours(clock, now)} h for an answer of ours, since ${zone.shortMinute(new Date(clock.since))}; ` +
    `answer it in words on GitHub by ${zone.shortMinute(due)}, its ${targets[clock.kind]} h target, or GH-LATE goes to the lead`
  );
}

/** The lead's GH-LATE line for a clock past its target. */
export function lateText(clock: Clock, now: number, zone: TimeZone, targets: ReplyTargetHours): string {
  return (
    `GH-LATE ${clock.ref} (${clock.kind}, ${clock.owner}) has waited ${waitedHours(clock, now)} h for an answer of ours since ` +
    `${zone.shortMinute(new Date(clock.since))}, past its ${targets[clock.kind]} h target: have ${clock.owner} answer it on GitHub`
  );
}

/** How many refs a grouped line names before it gives the rest as a count (#1475). */
const GROUPED_REFS = 3;

/** When a clock's answer target falls. */
export function dueAt(clock: Pick<Clock, 'kind' | 'since'>, targets: ReplyTargetHours): number {
  return clock.since + targetMs(clock.kind, targets);
}

/** The first GROUPED_REFS of `clocks` as `named` words them, and ` and N more` for the rest. */
function namedRefs(clocks: readonly Clock[], named: (clock: Clock) => string): string {
  const more = clocks.length - GROUPED_REFS;
  return `${clocks.slice(0, GROUPED_REFS).map(named).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * One owner's reminders of one sync as one unwoken line (#1475): a thread alone as `reminderText` words it, several
 * as their count and the first few by when each falls due, so many open threads never flood the owner's inbox.
 */
export function remindersText(clocks: readonly Clock[], now: number, zone: TimeZone, targets: ReplyTargetHours): string {
  const [only] = clocks;
  if (only !== undefined && clocks.length === 1) {
    return reminderText(only, now, zone, targets);
  }
  const byDue = [...clocks].sort((a, b) => dueAt(a, targets) - dueAt(b, targets));
  return (
    `${clocks.length} GitHub threads wait for an answer of ours: ${namedRefs(byDue, (clock) => `${clock.ref} (${clock.kind}, by ${zone.shortMinute(new Date(dueAt(clock, targets)))})`)}; ` +
    'answer each in words on GitHub by its target, or GH-LATE goes to the lead'
  );
}

/** The lead's one GH-LATE line for every late clock (#1475): one as `lateText` words it, several as their count and the oldest few. */
export function lateGroupText(clocks: readonly Clock[], now: number, zone: TimeZone, targets: ReplyTargetHours): string {
  const [only] = clocks;
  if (only !== undefined && clocks.length === 1) {
    return lateText(only, now, zone, targets);
  }
  const oldest = [...clocks].sort((a, b) => a.since - b.since);
  return (
    `GH-LATE ${clocks.length} GitHub threads waited past their answer target for an answer of ours, oldest first: ` +
    `${namedRefs(oldest, (clock) => `${clock.ref} (${clock.kind}, ${clock.owner}, ${waitedHours(clock, now)} h)`)}: have their owners answer them on GitHub`
  );
}

/** The late clock whose target passed last: a grouped GH-LATE is told again only when a newer wait goes late (#1475). */
export function newestLate(clocks: readonly Clock[], targets: ReplyTargetHours): Clock | undefined {
  return clocks.reduce<Clock | undefined>((newest, clock) => (newest === undefined || dueAt(clock, targets) > dueAt(newest, targets) ? clock : newest), undefined);
}
