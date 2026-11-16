import type { AreaMap } from '../config/areas.ts';
import { MAX_DESCRIPTION } from '../config/defaults.ts';
import { targetText, type IssueTarget } from '../issues/host.ts';

/**
 * The intake of an outside pull request (`teamrig issue intake`, T3187): which sessions are asked to review it, and
 * the task that answers its author once every verdict is in. Each session owning an area the pull request changes
 * (`github.areaPaths`, by the owner `github.areaOwners` names) is asked a best-fix and overlap review of its own paths, as it knows that code and its open work best; a
 * path under a security review entry asks the security reviewer too, in parallel; the session that takes it in reviews
 * the paths no area owns and replies to the author only after the reviews (its task's plan dependency). The paths are
 * the outsider's input: each is quoted as JSON, and a list longer than a task's description holds is cut with a count.
 */

/** The pull request's changed paths, as one bounded read gave them (HostPullFiles). */
export interface IntakeFiles {
  readonly paths: readonly string[];
  /** Names the read left out as no plain path. */
  readonly leftOut: number;
  /** The files the read listed: a rename gives two paths of one file, so the page's count is this, not the paths'. */
  readonly listed: number;
  /** The most files one read lists: a read that listed that many may have missed the rest. */
  readonly perRead: number;
}

export interface IntakeInput {
  readonly target: IssueTarget;
  readonly files: IntakeFiles;
  readonly areas: AreaMap;
  /** Whether a path sits under a review gate entry of class `security` (push-guard/review-paths.ts). */
  readonly isSecurityPath: (path: string) => boolean;
  /** Who reviews a security path for the caller (push-guard/review-gate.ts reviewRoute), if anyone but the caller. */
  readonly securityReviewer: string | undefined;
  /** The session that takes the pull request in: it replies to the author. */
  readonly caller: string;
}

/** One review asked of a session: an area owner's best-fix and overlap review, or the security pass. */
export interface IntakeAsk {
  readonly kind: 'area' | 'security';
  /** A session id of the team, or a `<team>/<id>` address for a reviewer on another team of the tree. */
  readonly owner: string;
  readonly title: string;
  readonly description: string;
}

/** The task of the caller's own that answers the author once every review is done. */
export interface IntakeReply {
  readonly title: string;
  readonly description: string;
}

export interface IntakePlan {
  readonly asks: readonly IntakeAsk[];
  readonly reply: IntakeReply;
}

/** The title of the reply task, which marks the pull request as taken in: a second intake of it is refused. */
export function intakeReplyTitle(target: IssueTarget): string {
  return `Reply to outside PR ${targetText(target)} once its reviews are in`;
}

export function intakePlan(input: IntakeInput): IntakePlan {
  const { target, files, areas, caller } = input;
  const shown = targetText(target);
  const split = areas.split(target.repo, files.paths);
  const own = split.owners.find((share) => share.session === caller)?.paths ?? [];
  const asks: IntakeAsk[] = split.owners
    .filter((share) => share.session !== caller)
    .map((share) => ({
      kind: 'area',
      owner: share.session,
      // The register refuses an active task's title again whoever owns it, so each owner's ask names that owner.
      title: `Best-fix and overlap review of outside PR ${shown} for ${share.session}`,
      description: described(
        `Review outside PR ${shown} in your area: is its fix the best one, and does it overlap your open tasks? Say your verdict on this task; ${caller} replies to the author once every review is in. Your paths, as the PR names them:`,
        share.paths,
      ),
    }));
  const guarded = files.paths.filter((path) => input.isSecurityPath(path));
  const reviewer = input.securityReviewer;
  if (guarded.length > 0 && reviewer !== undefined) {
    asks.push({
      kind: 'security',
      owner: reviewer,
      title: `Security review of outside PR ${shown}`,
      description: described(
        `Security review of outside PR ${shown}, which changes guarded paths, in parallel with its area reviews. Say your verdict on this task; ${caller} replies to the author once every review is in. The guarded paths, as the PR names them:`,
        guarded,
      ),
    });
  }
  return { asks, reply: { title: intakeReplyTitle(target), description: replyDescription(input, shown, [...own, ...split.unowned], guarded.length > 0 && reviewer === undefined) } };
}

/** The reply task's text: what to review itself, what the read could not see, and when to answer. */
function replyDescription(input: IntakeInput, shown: string, yours: readonly string[], guardedUnasked: boolean): string {
  const { files } = input;
  const notes = [
    ...(files.listed >= files.perRead ? [`The read gave its first ${files.perRead} files only: review the rest yourself.`] : []),
    ...(files.leftOut > 0 ? [`${files.leftOut} file name(s) were no plain path and were left out: read them on GitHub.`] : []),
    ...(guardedUnasked ? ['It changes guarded paths and no one but you reviews them: set roles.securityReviewer.'] : []),
  ];
  const head = `Answer the author of outside PR ${shown} once every review task this depends on is done: the best fix, or the change asked. ${notes.join(' ')}`.trimEnd();
  return yours.length === 0 ? head : described(`${head} Yours to review, owned by no other area:`, yours);
}

/** `head`, then the paths quoted as JSON, as many as fit a task's description, the rest counted. */
function described(head: string, paths: readonly string[]): string {
  const quoted = paths.map((path) => JSON.stringify(path));
  for (let kept = quoted.length; kept > 0; kept -= 1) {
    const left = quoted.length - kept;
    const text = `${head} ${[...quoted.slice(0, kept), ...(left === 0 ? [] : [`and ${left} more`])].join(', ')}`;
    if (text.length <= MAX_DESCRIPTION) {
      return text;
    }
  }
  return `${head} ${quoted.length} path(s), too long to list: read them on GitHub`;
}
