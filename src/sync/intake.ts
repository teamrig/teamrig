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
 * A code host that cannot list the paths (no codehost.pull-files) gets every area owner of the repository asked, and
 * the security reviewer always: who reviews never rests on a read that did not happen.
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
  /**
   * The paths one read gave; undefined when the code host cannot list a pull request's files (it has no
   * codehost.pull-files), so every area owner of the repository and the security reviewer are asked.
   */
  readonly files: IntakeFiles | undefined;
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
  const { files } = input;
  return files === undefined ? unlistedPlan(input) : listedPlan(input, files);
}

/** The plan when the host listed the paths: each owner is asked about its own, security about the guarded or unseen ones. */
function listedPlan(input: IntakeInput, files: IntakeFiles): IntakePlan {
  const { target, areas, caller } = input;
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
  const unseen = unseenNotes(files);
  const reviewer = input.securityReviewer;
  // A file the read could not see may be guarded, so the security review is asked whenever one is unseen: which files
  // fill the one page is the author's choice, and it must not decide who reviews.
  if ((guarded.length > 0 || unseen.length > 0) && reviewer !== undefined) {
    const why = guarded.length > 0 ? 'which changes guarded paths' : 'whose files the read could not all see';
    const head = `Security review of outside PR ${shown}, ${why}, in parallel with its area reviews. Say your verdict on this task; ${caller} replies to the author once every review is in. ${unseen.join(' ')}`.trimEnd();
    asks.push({
      kind: 'security',
      owner: reviewer,
      title: `Security review of outside PR ${shown}`,
      description: guarded.length === 0 ? head : described(`${head} The guarded paths, as the PR names them:`, guarded),
    });
  }
  return { asks, reply: { title: intakeReplyTitle(target), description: replyDescription(files, shown, [...own, ...split.unowned], guarded.length > 0 && reviewer === undefined) } };
}

/**
 * The plan when the code host cannot list the paths: no one can tell whose area it changes or whether it touches a
 * guarded path, so every other session owning an area of the repository is asked, and the security reviewer always.
 */
function unlistedPlan(input: IntakeInput): IntakePlan {
  const { target, areas, caller } = input;
  const shown = targetText(target);
  const unlisted = 'The code host cannot list its changed files (no codehost.pull-files), so every area owner is asked: read them on the host.';
  const asks: IntakeAsk[] = areas
    .sessionsOf(target.repo)
    .filter((session) => session !== caller)
    .map((session) => ({
      kind: 'area',
      owner: session,
      title: `Best-fix and overlap review of outside PR ${shown} for ${session}`,
      description: `Review outside PR ${shown} where it changes your area, if it does: is its fix the best one, and does it overlap your open tasks? Say your verdict on this task; ${caller} replies to the author once every review is in. ${unlisted}`,
    }));
  const reviewer = input.securityReviewer;
  if (reviewer !== undefined) {
    asks.push({
      kind: 'security',
      owner: reviewer,
      title: `Security review of outside PR ${shown}`,
      description: `Security review of outside PR ${shown}, whose files the code host cannot list, in parallel with its area reviews. Say your verdict on this task; ${caller} replies to the author once every review is in. ${unlisted}`,
    });
  }
  const notes = [unlisted, ...(reviewer === undefined ? ['No one but you reviews its guarded paths, if any: set roles.securityReviewer.'] : [])];
  return {
    asks,
    reply: {
      title: intakeReplyTitle(target),
      description: `Answer the author of outside PR ${shown} once every review task this depends on is done: the best fix, or the change asked. Review what no other area owns. ${notes.join(' ')}`,
    },
  };
}

/** The reply task's text: what to review itself, what the read could not see, and when to answer. */
function replyDescription(files: IntakeFiles, shown: string, yours: readonly string[], guardedUnasked: boolean): string {
  const notes = [
    ...unseenNotes(files),
    ...(guardedUnasked ? ['It changes guarded paths and no one but you reviews them: set roles.securityReviewer.'] : []),
  ];
  const head = `Answer the author of outside PR ${shown} once every review task this depends on is done: the best fix, or the change asked. ${notes.join(' ')}`.trimEnd();
  return yours.length === 0 ? head : described(`${head} Yours to review, owned by no other area:`, yours);
}

/** What the read could not see, a sentence each: a full page may have more files after it, and a name left out may be any path. */
function unseenNotes(files: IntakeFiles): string[] {
  return [
    ...(files.listed >= files.perRead ? [`The read gave its first ${files.perRead} files only: review the rest on GitHub.`] : []),
    ...(files.leftOut > 0 ? [`${files.leftOut} file name(s) were no plain path and were left out: read them on GitHub.`] : []),
  ];
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
