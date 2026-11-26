import type { LeadTree } from '../config/lead-tree.ts';
import type { KitConfig, RolesConfig } from '../config/types.ts';
import { githubWatcher } from '../sync/watcher.ts';
import type { ApprovalAnswer, Task } from './fold.ts';
import type { PersonWait, WaitAnswerers, WaitReason } from './waits.ts';

/**
 * The roles that answer an approval besides a task owner's leaders: the security reviewer, and the answerer
 * with the team's sessions, any of which may approve an outside change on the answerer's own task (owner order, T3448).
 */
export interface ApprovalRoles extends Pick<RolesConfig, 'securityReviewer'> {
  readonly answerer?: { readonly session: string; readonly team: readonly string[] };
}

/**
 * The approval roles of a team's config: its security reviewer, and its answerer (`githubWatcher`) among its
 * sessions, unless that is the team's lead, whose approvals stay as they are: its own clears its merge already.
 */
export function approvalRolesOf(config: Pick<KitConfig, 'roles' | 'github' | 'serviceRoles' | 'sessions'>): ApprovalRoles {
  const { securityReviewer } = config.roles;
  const session = githubWatcher(config);
  const answering = session === config.roles.lead ? {} : { answerer: { session, team: config.sessions } };
  return securityReviewer === undefined ? answering : { securityReviewer, ...answering };
}

/**
 * Who answers a wait on a task of `owner`'s: its leaders (`LeadTree.approversOf`) a decision or an approval, and the
 * team's security reviewer (`roles.securityReviewer`) an approval too, which is how the review gate holds a change
 * for it (T828), but never one on its own task. On the answerer's own task every other session of the team
 * answers an approval too: an outside change touching files of another session's open branch is that session's to
 * approve (T3448), which only `ship.ts merge` reads, for the session that branch names. A push to a protected branch
 * still reads only the leaders' approvals (`approvedTaskOf`).
 */
export function waitAnswerersOf(tree: Pick<LeadTree, 'approversOf'>, roles: ApprovalRoles, owner: string): WaitAnswerers {
  const leaders = tree.approversOf(owner);
  const reviewer = roles.securityReviewer;
  const reviews = reviewer !== undefined && reviewer !== owner && !leaders.includes(reviewer);
  const approval = reviews ? [...leaders, reviewer] : leaders;
  const answering = roles.answerer;
  const peers = answering !== undefined && answering.session === owner ? answering.team.filter((session) => session !== owner && !approval.includes(session)) : [];
  return { decision: leaders, approval: [...approval, ...peers] };
}

/**
 * The task's answer to `reason` when it is an approval wait its giver answered, either way (`approve`, T684);
 * undefined otherwise. A new status clears the answer with the waits (fold.ts), so an answer covers only the step its
 * task asked about; the approval wait set again keeps it while the note names no other head (T2117, T3044).
 */
export function answerTo(task: Pick<Task, 'answer'>, reason: WaitReason): ApprovalAnswer | undefined {
  return reason.kind === 'approval' && task.answer !== null && task.answer.by === reason.who ? task.answer : undefined;
}

/** Whether the task's answer clears `reason`: an approval wait whose giver approved it. */
export function approvalCleared(task: Pick<Task, 'answer'>, reason: WaitReason): boolean {
  return answerTo(task, reason)?.verdict === 'approved';
}

const COMMIT_SHA = /^[0-9a-f]{7,40}$/;
const COMMIT_SHA_RUN = /\b[0-9a-f]{7,40}\b/g;

/** Whether `text` is a commit sha, full or abbreviated to at least 7 hex digits. */
export function isCommitSha(text: string): boolean {
  return COMMIT_SHA.test(text);
}

/**
 * Whether the task's answer note names a sha `head` starts with: an approval covers only the head it names, so an
 * approval of an earlier head never clears a later one (T2788). Shared by the ship tool's merge and `teamrig pr`
 * (T4817).
 */
export function answerNamesHead(task: Pick<Task, 'answer'>, head: string): boolean {
  const named = task.answer?.note?.match(COMMIT_SHA_RUN) ?? [];
  return named.some((sha) => head.startsWith(sha));
}

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const FULL_COMMIT_SHA_RUN = /\b[0-9a-f]{40}\b/g;

/** Whether `text` is a full 40-hex commit sha. */
export function isFullCommitSha(text: string): boolean {
  return FULL_COMMIT_SHA.test(text);
}

/**
 * Whether the task's answer note names `head` in full: what `teamrig pr` holds an outside pull request's approval to
 * (T4958 C1). Its author picks the commits, and a commit sharing a 7-hex prefix with the approved head is cheap to
 * grind, so a prefix match could carry the approval over to code no one reviewed.
 */
export function answerNamesFullHead(task: Pick<Task, 'answer'>, head: string): boolean {
  const named: readonly string[] = task.answer?.note?.match(FULL_COMMIT_SHA_RUN) ?? [];
  return named.includes(head);
}

/** A task of the owner's that one of its approvers approved, with who did. */
export interface ApprovedTask {
  readonly task: Task;
  readonly by: string;
}

/**
 * The first task of `owner`'s, in register order, that waits on the approval of one of `approvers` (its leaders,
 * `LeadTree.chainOf`) and has it: what lets `owner` push to a protected branch under `pushGuard.pushToProtected: lead`
 * or `gated`.
 * Undefined when it holds none.
 */
export function approvedTaskOf(tasks: Iterable<Task>, owner: string, approvers: readonly string[]): ApprovedTask | undefined {
  for (const task of tasks) {
    if (task.owner !== owner || task.status !== 'waiting') {
      continue;
    }
    const reason = task.waits.find(
      (wait): wait is PersonWait => wait.kind === 'approval' && approvers.includes(wait.who) && approvalCleared(task, wait),
    );
    if (reason !== undefined) {
      return { task, by: reason.who };
    }
  }
  return undefined;
}
