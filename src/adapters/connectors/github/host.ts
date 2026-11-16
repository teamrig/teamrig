import {
  exitText,
  isLogin,
  isRecord,
  LABEL_FILE,
  MAX_COMMENT,
  parseLabelFile,
  plainLine,
  targetText,
  withStampFooter,
  type CloseReason,
  type Env,
  type FieldValue,
  type HostAssignee,
  type HostComments,
  type HostEnd,
  type HostField,
  type HostFieldRead,
  type HostIssueId,
  type HostIssueLabels,
  type HostJobLog,
  type HostLabel,
  type HostLabelFile,
  type HostLinks,
  type HostList,
  type HostOpen,
  type HostLanding,
  type HostPosts,
  type HostPulls,
  type FoundIssue,
  type HostCommit,
  type HostPullStand,
  type HostPullWork,
  type HostPullFiles,
  type HostReach,
  type HostRerun,
  type HostSearch,
  type HostThread,
  type HostUse,
  type HostViewer,
  type HostWatch,
  type IssueDraft,
  type IssueFields,
  type IssueHost,
  type IssueQuery,
  type IssueReopen,
  type IssueSearch,
  type IssueState,
  type IssueTarget,
  type IssueThread,
  type LabelSpec,
  type PullStand,
  type SecretScanner,
  type WatchMarks,
} from '../../../plugin-api/index.ts';
import {
  assigneeReadArgs,
  blockedByAddArgs,
  commentsReadArgs,
  fieldValueSetArgs,
  pullFilesArgs,
  issueAssignArgs,
  issueAssigneeReadArgs,
  issueUnassignArgs,
  issueBodyCall,
  issueCloseArgs,
  issueReopenArgs,
  issueCommentCall,
  issueCreateCall,
  issueLabelAddArgs,
  issueLabelRemoveArgs,
  issueReadArgs,
  issueSearchArgs,
  type SearchKind,
  searchTerms,
  widensSearch,
  issueTypeSetArgs,
  jobLogArgs,
  pullApproveArgs,
  pullEnqueueArgs,
  pullMergeArgs,
  pullStandArgs,
  BASE_BRANCH,
  commitReadArgs,
  pullCompareArgs,
  runReadArgs,
  runRerunArgs,
  labelReadArgs,
  labelCreateArgs,
  labelFileReadArgs,
  subIssueAddArgs,
  PULL_FILES_PAGE,
  WATCH_PATHS,
  watchProbeArgs,
  userReadArgs,
  viewerReadArgs,
  type GhCall,
  type GhResult,
  type GhRunner,
  type WatchPath,
} from './gh.ts';
import { type ProbeAnswer, probeAnswerOf } from './probe.ts';
import { createdNumber, failureText, ghFailureKind, ISSUE_LIMIT, type IssueList, latestIssues, listIssues, readCommentsIn, readPullFilesIn, type ReadKind, runRead, startFailureText, unreachableText } from './issues.ts';
import { readFields } from './fields.ts';
import { searchIn } from './search.ts';
import { failedLogExcerpt } from './job-log.ts';
import { listLinks } from './links.ts';
import { readPosts } from './posts.ts';
import { pullStandIn } from './pull-stand.ts';
import { COMMIT_FILES_MAX, COMPARE_COMMITS_MAX, commitIn, compareIn } from './pull-work.ts';
import { listPulls, PULL_LIMIT } from './pulls.ts';
import { PULL_PAGE_SIZE } from './queries.ts';
import { type RunState, rerunRefusal, runStateOf } from './run-state.ts';
import { NoAccessError, type RepoAccess, type RepoTokens } from './tokens.ts';

/** A failed job's log read, as a failure line words it: the Actions permission lets a token read it. */
const JOB_LOG_READ: ReadKind = { noun: 'failed job logs', permission: 'Actions', command: 'gh run view' };

/** A CI run's read before its re-run, as a failure line words it: the Actions permission lets a token read it. */
const RUN_READ: ReadKind = { noun: 'CI runs', permission: 'Actions', command: 'gh api' };

/** What each use does with an access, as its ACCESS line words it. */
const USE_VERB: Readonly<Record<HostUse, string>> = { read: 'read with', open: 'opens issues with', write: 'writes with' };

/**
 * GitHub as an issue host (issues/host.ts): a list is pages of the two shipped issue queries, a links read pages of
 * the third, and each write one gh REST call the runner's allowlist takes (gh.ts), made with the token saved for the
 * repository's owner. An owner with no saved token, or one the store cannot read, is reached by nothing: never the
 * gh login in its place (tokens.ts). gh's own error, any secret shape in it redacted, is the reason a write failed.
 * Each text it posts (an issue's body, a comment, a replaced body) carries the made-with-teamrig footer when `stamp`
 * is on (#1102): this class is the one place every GitHub text write passes, so no command can post unstamped by
 * forgetting it.
 */
export class GitHubIssueHost implements IssueHost {
  readonly name = 'GitHub';
  private readonly gh: GhRunner;
  private readonly tokens: RepoTokens;
  private readonly scanner: SecretScanner;
  private readonly stamp: boolean;

  constructor(gh: GhRunner, tokens: RepoTokens, scanner: SecretScanner, stamp: boolean) {
    this.gh = gh;
    this.tokens = tokens;
    this.scanner = scanner;
    this.stamp = stamp;
  }

  /**
   * `body` with one footer (core/stamp.ts replaces an earlier one), or as given when the stamp is off or the footer
   * would take it past the most GitHub holds: the text matters more than the credit.
   */
  private stamped(body: string): string {
    const stamped = this.stamp ? withStampFooter(body) : body;
    return stamped.length <= MAX_COMMENT ? stamped : body;
  }

  /**
   * Reached with the repository's own saved key, else its owner's; never the gh login. The scope is what the picked
   * key covers, the repository or its owner, so a command says each key it reads with once.
   */
  async reach(repo: string, use: HostUse): Promise<HostReach> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'unreachable', reason: access.message };
    }
    const verb = USE_VERB[use];
    return {
      kind: 'reached',
      access: `${access.scope}: ${verb} the token saved as ${access.credential}`,
      scope: access.scope,
    };
  }

  /**
   * The open issues, then those closed on or after `closedSince`. When either read fails nothing of the repository
   * is given, so its tasks are not judged on half a read.
   */
  async list(repo: string, closedSince: string): Promise<HostList> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    const open = await listIssues(this.gh, access, { repo, state: 'open', limit: ISSUE_LIMIT });
    if (open.kind === 'failed') {
      return open;
    }
    const closed = await listIssues(this.gh, access, { repo, state: 'closed', closedSince, limit: ISSUE_LIMIT });
    if (closed.kind === 'failed') {
      return closed;
    }
    return { kind: 'listed', issues: latestIssues(open.issues, closed.issues), notes: [...listNotes('open', open), ...listNotes('closed', closed)], cut: open.full };
  }

  /**
   * The open pull requests, then those changed since `since`, as the owner's saved token reads them
   * (pulls.ts). With no `since` the second read takes one page, which only dates the next read.
   */
  async pulls(repo: string, since: string | undefined): Promise<HostPulls> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    const open = await listPulls(this.gh, access, { repo, read: 'open', since: undefined, limit: PULL_LIMIT });
    if (open.kind === 'failed') {
      return open;
    }
    const changed = await listPulls(this.gh, access, { repo, read: 'changed', since, limit: since === undefined ? PULL_PAGE_SIZE : PULL_LIMIT });
    if (changed.kind === 'failed') {
      return changed;
    }
    const unreadable = open.unreadable + changed.unreadable;
    const notes = [
      ...(open.full ? [`the open pull request read reached ${PULL_LIMIT}, so it may leave some out`] : []),
      ...(since !== undefined && changed.full ? [`the changed pull request read reached ${PULL_LIMIT}, so it may leave some out`] : []),
      ...(unreadable > 0 ? [`${unreadable} item(s) gh printed did not read as pull requests and were left out`] : []),
    ];
    return { kind: 'listed', open: open.pulls, changed: changed.pulls, notes };
  }

  /**
   * The end of one failed job's log (job-log.ts), as the owner's saved token reads it; each line and
   * a failure's reason have any secret shape redacted.
   */
  async jobLog(repo: string, jobId: number): Promise<HostJobLog> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    const run = await runRead(this.gh, access, repo, jobLogArgs(repo, jobId), JOB_LOG_READ);
    if (run.kind === 'failed') {
      return { kind: 'failed', reason: this.scanner.redact(run.reason) };
    }
    return { kind: 'read', ...failedLogExcerpt(run.stdout, (text) => this.scanner.redact(text)) };
  }

  /**
   * Reads the run first (gh.ts isRunRead) and refuses, writing nothing, unless run-state.ts rerunRefusal lets it be
   * re-run: ended failed, cancelled or timed out (a passed release run re-run would publish again), started by a push,
   * pull request, merge queue or schedule, before its third attempt. Then starts its failed jobs again (gh.ts
   * isRunRerun), with the owner's saved token, which needs Actions Read and write. A run stopped by a signal may still
   * have started it, so its line says to look first; GitHub's own refusal (one too old) is the reason, any secret
   * shape redacted.
   */
  async rerunRun(repo: string, runId: number): Promise<HostRerun> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    let read: GhResult;
    try {
      read = await this.gh.run({ args: runReadArgs(repo, runId), env: access.env });
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
    const readEnd = read.end;
    if (readEnd.kind === 'exited' && readEnd.code !== 0 && ghFailureKind(readEnd.code, read.stderr) === 'not-visible') {
      // A team repository the token reaches answers Not Found for a wrong run id: the line names the id first.
      return { kind: 'failed', reason: this.scanner.redact(rerunFailureText(repo, runId, readEnd.code, read.stderr, access)) };
    }
    if (readEnd.kind !== 'exited' || readEnd.code !== 0) {
      return { kind: 'failed', reason: this.scanner.redact(failureText(repo, read, access, RUN_READ)) };
    }
    const state = runStateOf(read.stdout);
    if (state === undefined) {
      return { kind: 'failed', reason: `the read of run ${String(runId)} of ${repo} printed no status and conclusion; nothing was re-run` };
    }
    const refusal = rerunRefusal(repo, runId, state);
    if (refusal !== undefined) {
      return { kind: 'refused', reason: refusal };
    }
    let result: GhResult;
    try {
      result = await this.gh.run({ args: runRerunArgs(repo, runId), env: access.env });
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
    if (result.end.kind === 'signal') {
      return { kind: 'failed', reason: `gh was stopped (${result.end.signal}) on its way to re-run run ${String(runId)} of ${repo}: look on GitHub before a rerun` };
    }
    if (result.end.code !== 0) {
      const reason = this.scanner.redact(rerunFailureText(repo, runId, result.end.code, result.stderr, access));
      return ghFailureKind(result.end.code, result.stderr) === undefined ? this.rerunAfterOddFailure(repo, runId, state, access, reason) : { kind: 'failed', reason };
    }
    return { kind: 'done', workflow: state.workflow, event: state.event, attempt: state.attempt + 1 };
  }

  /**
   * gh failed the re-run call with no known refusal, such as `unexpected end of JSON input` when GitHub answers an
   * error with an empty body and gh hides its status (T5610): the run is read again, so a re-run GitHub started all
   * the same is done, and one it did not start says so, safe to run again since the read refuses a second re-run.
   */
  private async rerunAfterOddFailure(repo: string, runId: number, before: RunState, access: RepoAccess, reason: string): Promise<HostRerun> {
    let read: GhResult;
    try {
      read = await this.gh.run({ args: runReadArgs(repo, runId), env: access.env });
    } catch {
      return { kind: 'failed', reason: `${reason}; the run could not be read after it: look on GitHub before a rerun` };
    }
    const after = read.end.kind === 'exited' && read.end.code === 0 ? runStateOf(read.stdout) : undefined;
    if (after === undefined) {
      return { kind: 'failed', reason: `${reason}; the run could not be read after it: look on GitHub before a rerun` };
    }
    if (after.attempt > before.attempt) {
      return { kind: 'done', workflow: after.workflow, event: after.event, attempt: after.attempt };
    }
    return { kind: 'failed', reason: `${reason}; the run reads attempt ${String(after.attempt)} still, so nothing was re-run: run it again` };
  }

  /** The posts of `repo` changed since `since` (posts.ts), as the owner's saved token reads them. */
  async posts(repo: string, since: string): Promise<HostPosts> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    const read = await readPosts(this.gh, access, repo, since);
    if (read.kind === 'failed') {
      return { kind: 'failed', reason: this.scanner.redact(read.reason) };
    }
    const notes = read.unreadable > 0 ? [`${read.unreadable} item(s) gh printed did not read as comments, reviews or bodies and were left out`] : [];
    return { kind: 'read', posts: read.posts, cutAt: read.cutAt, notes };
  }

  /**
   * Opens one issue. A failure is one plain line with gh's own first error line, any secret shape in it redacted; a
   * run stopped by a signal, or one that printed no issue number, may still have opened it, so its line says to
   * look before a rerun.
   */
  async open(draft: IssueDraft): Promise<HostOpen> {
    const access = await this.tokens.accessFor(draft.repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    let result: GhResult;
    try {
      result = await this.gh.run({ ...issueCreateCall({ ...draft, body: this.stamped(draft.body) }), env: access.env });
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
    const look = `look for it on ${draft.repo} before a rerun, and set the task's ref if it is there`;
    if (result.end.kind === 'signal') {
      return { kind: 'failed', reason: `gh was stopped (${result.end.signal}) while opening the issue: ${look}` };
    }
    if (result.end.code !== 0) {
      return { kind: 'failed', reason: this.scanner.redact(plainLine(`gh api for an issue of ${draft.repo} ${exitText(result.end.code, result.stderr)}`)) };
    }
    const number = createdNumber(result.stdout);
    return number === undefined ? { kind: 'failed', reason: `gh printed no issue number: ${look}` } : { kind: 'opened', target: { repo: draft.repo, number } };
  }

  comment(target: IssueTarget, body: string): Promise<HostEnd> {
    return this.write(target, issueCommentCall(target, this.stamped(body)), 'comment on');
  }

  editBody(target: IssueTarget, body: string): Promise<HostEnd> {
    return this.write(target, issueBodyCall(target, this.stamped(body)), 'edit the body of');
  }

  close(target: IssueTarget, reason?: CloseReason, duplicateId?: number): Promise<HostEnd> {
    return this.write(target, { args: issueCloseArgs(target, reason, duplicateId) }, 'close');
  }

  /** The reopen of one closed issue or pull request, through its allowlisted line (gh.ts isIssueReopen). */
  readonly reopen: IssueReopen = {
    reopenIssue: (target: IssueTarget): Promise<HostEnd> => this.write(target, { args: issueReopenArgs(target) }, 'reopen'),
  };

  /**
   * Reads the one issue for its `id`: found with it, missing when GitHub answers Not Found (no such issue, or one the
   * access cannot see), else failed with gh's own line, or when the answer holds no id.
   */
  async issueId(target: IssueTarget): Promise<HostIssueId> {
    const shown = targetText(target);
    const access = await this.tokens.accessFor(target.repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    let result: GhResult;
    try {
      result = await this.gh.run({ args: issueReadArgs(target), env: access.env });
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
    if (result.end.kind === 'signal') {
      return { kind: 'failed', reason: `gh was stopped (${result.end.signal}) while reading ${shown}` };
    }
    if (result.end.code !== 0) {
      return ghFailureKind(result.end.code, result.stderr) === 'not-visible'
        ? { kind: 'missing' }
        : { kind: 'failed', reason: this.scanner.redact(plainLine(`gh api to read ${shown} ${exitText(result.end.code, result.stderr)}`)) };
    }
    const id = issueIdIn(result.stdout);
    return id === undefined ? { kind: 'failed', reason: `gh printed no id for ${shown}` } : { kind: 'found', id };
  }

  /** A label here takes any name, a space too, so each is held as it is. */
  labelName(label: string): string {
    return label;
  }

  /**
   * Reads one issue or pull request through the same REST read as its id (an issue's path serves a pull request too):
   * read with its state, labels, assignees, kind and body; missing on Not Found; else failed with gh's own line, or
   * when the answer has no issue's shape.
   */
  async thread(target: IssueTarget): Promise<HostThread> {
    const shown = targetText(target);
    const read = await this.read(target.repo, issueReadArgs(target), shown);
    if (read.kind !== 'found') {
      return read;
    }
    const thread = threadIn(read.stdout);
    return thread === undefined ? { kind: 'failed', reason: `gh printed no issue for ${shown}` } : { kind: 'read', thread };
  }

  /**
   * Reads the one label: found when gh ends well, missing when GitHub answers Not Found (no such label, or a
   * repository the access cannot see, which the add would fail on anyway), else failed with gh's own line.
   */
  async labelExists(repo: string, label: string): Promise<HostLabel> {
    const read = await this.read(repo, labelReadArgs(repo, label), `the label ${JSON.stringify(label)} of ${repo}`);
    return read.kind === 'found' ? { kind: 'found' } : read;
  }

  /**
   * Reads the repository's label file raw, as it stands on the default branch: read with the labels it names; missing
   * on Not Found (no such file, or a repository the access cannot see); failed with gh's line, or with what is wrong in
   * the file. The runner allows the create of a label this read named, and of no other beside teamrig's own (gh.ts).
   */
  async labelFile(repo: string): Promise<HostLabelFile> {
    const what = `${LABEL_FILE} of ${repo}`;
    const read = await this.read(repo, labelFileReadArgs(repo), what);
    if (read.kind !== 'found') {
      return read;
    }
    try {
      return { kind: 'read', labels: parseLabelFile(read.stdout) };
    } catch (error) {
      return { kind: 'failed', reason: plainLine(`the ${what} does not parse: ${error instanceof Error ? error.message : String(error)}`) };
    }
  }

  /**
   * Reads one page of the issue's comments updated at or after `since`, oldest first (gh.ts commentsReadArgs), each
   * with its text matched for a claim line and dropped. An issue GitHub no longer shows fails the read.
   */
  async newComments(target: IssueTarget, since: number): Promise<HostComments> {
    const shown = `the new comments of ${targetText(target)}`;
    const read = await this.read(target.repo, commentsReadArgs(target, new Date(since).toISOString()), shown);
    if (read.kind === 'missing') {
      return { kind: 'failed', reason: `GitHub shows no ${targetText(target)} to read ${shown} of` };
    }
    if (read.kind === 'failed') {
      return read;
    }
    const comments = readCommentsIn(read.stdout);
    return comments === undefined ? { kind: 'failed', reason: `gh printed no comment list for ${shown}` } : { kind: 'read', comments };
  }

  /**
   * Reads one page of the pull request's changed files (gh.ts pullFilesArgs) and keeps their paths. An issue that is
   * no pull request, or one GitHub does not show, fails the read.
   */
  async pullFiles(target: IssueTarget): Promise<HostPullFiles> {
    const shown = `the changed files of ${targetText(target)}`;
    const read = await this.read(target.repo, pullFilesArgs(target), shown);
    if (read.kind === 'missing') {
      return { kind: 'failed', reason: `GitHub shows no pull request ${targetText(target)}: it is an issue, or one this access cannot see` };
    }
    if (read.kind === 'failed') {
      return read;
    }
    const files = readPullFilesIn(read.stdout);
    return files === undefined ? { kind: 'failed', reason: `gh printed no file list for ${shown}` } : { kind: 'read', ...files, perRead: PULL_FILES_PAGE };
  }

  /**
   * Reads whether the login may be assigned, as GitHub spells it. GitHub's assignee check matches a login's case
   * exactly (`octocat` is Not Found where `OctoCat` is the user), while teamrig keeps logins in lowercase, so the user
   * is read first for its login as GitHub keeps it. Found with that login when gh ends well; missing when GitHub answers
   * Not Found (no such user, not a person with access, an organisation, or a repository the access cannot see); else
   * failed with gh's own line.
   */
  async assigneeExists(repo: string, login: string): Promise<HostAssignee> {
    const user = await this.spelledLogin(repo, login);
    if (user.kind !== 'found') {
      return user;
    }
    const read = await this.read(repo, assigneeReadArgs(repo, user.login), `whether ${user.login} may be assigned in ${repo}`);
    return read.kind === 'found' ? user : read;
  }

  /**
   * Reads the user the token for `repo` belongs to (`gh api user`), for its login as GitHub spells it; failed with
   * gh's own line, as for a token that is no user's (an app's), or when the answer holds no login. Only the login is kept.
   */
  async viewer(repo: string): Promise<HostViewer> {
    const what = 'the GitHub user the token belongs to';
    const read = await this.read(repo, viewerReadArgs(), what);
    if (read.kind === 'missing') {
      return { kind: 'failed', reason: 'GitHub shows no user the token belongs to' };
    }
    if (read.kind === 'failed') {
      return read;
    }
    const login = loginIn(read.stdout);
    return login === undefined ? { kind: 'failed', reason: `gh printed no login for ${what}` } : { kind: 'found', login };
  }

  /**
   * Reads whether the login may be assigned to the one issue or pull request, as GitHub spells it (as assigneeExists
   * does): GitHub takes one with access to the repository, and also one who took part in the item. Found with that
   * login when gh ends well; missing when GitHub answers Not Found; else failed with gh's own line.
   */
  async assignableOn(target: IssueTarget, login: string): Promise<HostAssignee> {
    const user = await this.spelledLogin(target.repo, login);
    if (user.kind !== 'found') {
      return user;
    }
    const read = await this.read(target.repo, issueAssigneeReadArgs(target, user.login), `whether ${user.login} may be assigned to ${targetText(target)}`);
    return read.kind === 'found' ? user : read;
  }

  /**
   * Reads the one issue or pull request for the names of its labels: read with them, missing when GitHub answers Not
   * Found, else failed with gh's own line, or when the answer holds no label list.
   */
  async issueLabels(target: IssueTarget): Promise<HostIssueLabels> {
    const shown = targetText(target);
    const read = await this.read(target.repo, issueReadArgs(target), `the labels of ${shown}`);
    if (read.kind !== 'found') {
      return read;
    }
    const labels = labelNamesIn(read.stdout);
    return labels === undefined ? { kind: 'failed', reason: `gh printed no label list for ${shown}` } : { kind: 'read', labels };
  }

  /**
   * The user `login` names, with the login as GitHub keeps its case: GitHub's assignee checks match that case only,
   * while teamrig keeps logins in lowercase. Missing when GitHub has no such user.
   */
  private async spelledLogin(repo: string, login: string): Promise<HostAssignee> {
    if (!isLogin(login)) {
      return { kind: 'failed', reason: `${JSON.stringify(login)} is no GitHub login` };
    }
    const user = await this.read(repo, userReadArgs(login), `the GitHub user ${login}`);
    if (user.kind !== 'found') {
      return user;
    }
    const spelled = loginIn(user.stdout);
    if (spelled === undefined || spelled.toLowerCase() !== login.toLowerCase()) {
      return { kind: 'failed', reason: `gh printed no login ${login} for the GitHub user ${login}` };
    }
    return { kind: 'found', login: spelled };
  }

  /** One read of `what` in `repo`: found with what gh printed when it ends well, missing on Not Found, else failed with gh's own line. */
  private async read(repo: string, args: readonly string[], what: string): Promise<HostRead> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    let result: GhResult;
    try {
      result = await this.gh.run({ args, env: access.env });
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
    if (result.end.kind === 'signal') {
      return { kind: 'failed', reason: `gh was stopped (${result.end.signal}) while reading ${what}` };
    }
    if (result.end.code === 0) {
      return { kind: 'found', stdout: result.stdout };
    }
    if (ghFailureKind(result.end.code, result.stderr) === 'not-visible') {
      return { kind: 'missing' };
    }
    return { kind: 'failed', reason: this.scanner.redact(plainLine(`gh api to read ${what} ${exitText(result.end.code, result.stderr)}`)) };
  }

  /**
   * Makes the label in the repository. A run stopped by a signal may still have made it, which the next run's read
   * finds; a refused access says how to give it the write.
   */
  async createLabel(repo: string, label: LabelSpec): Promise<HostEnd> {
    const shown = `the label ${JSON.stringify(label.name)} in ${repo}`;
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    let result: GhResult;
    try {
      result = await this.gh.run({ args: labelCreateArgs(repo, label), env: access.env });
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
    if (result.end.kind === 'signal') {
      return { kind: 'failed', reason: `gh was stopped (${result.end.signal}) while making ${shown}` };
    }
    if (result.end.code !== 0) {
      return { kind: 'failed', reason: this.scanner.redact(plainLine(`gh api to make ${shown} ${exitText(result.end.code, result.stderr)}`)) };
    }
    return { kind: 'done' };
  }

  addLabels(target: IssueTarget, labels: readonly string[]): Promise<HostEnd> {
    return this.write(target, { args: issueLabelAddArgs(target, labels) }, 'label');
  }

  /** Takes the label off; Not Found here means the issue does not carry it (or is not there), which the reason says. */
  removeLabel(target: IssueTarget, label: string): Promise<HostEnd> {
    const shown = JSON.stringify(label);
    return this.write(target, { args: issueLabelRemoveArgs(target, label) }, `take ${shown} off`, `${targetText(target)} does not carry the label ${shown}, or is not there`);
  }

  /** Every issue of the repository with its links, read with the same access as a list. */
  async links(repo: string): Promise<HostLinks> {
    const access = await this.tokens.accessFor(repo);
    return access instanceof NoAccessError ? { kind: 'failed', reason: access.message } : listLinks(this.gh, access, repo);
  }

  addSubIssue(parent: IssueTarget, childId: number): Promise<HostEnd> {
    return this.write(parent, { args: subIssueAddArgs(parent, childId) }, 'add a sub-issue to');
  }

  addBlockedBy(target: IssueTarget, blockerId: number): Promise<HostEnd> {
    return this.write(target, { args: blockedByAddArgs(target, blockerId) }, 'add a blocker to');
  }

  assign(target: IssueTarget, logins: readonly string[]): Promise<HostEnd> {
    return this.write(target, { args: issueAssignArgs(target, logins) }, 'assign');
  }

  /**
   * Probes each of WATCH_PATHS with the tag `marks` holds for it (gh.ts isWatchProbe), each mark keyed by its path.
   * Changed when any answer changed, the new tags in the marks it gives (a path that failed keeps its old tag, so it
   * reads as changed again later); failed when none changed and one failed, with that line, any secret shape
   * redacted; else unchanged. GitHub answers an unchanged probe 304, which does not count against the rate limit.
   */
  /**
   * Issue fields and types: a read of the shipped fields query with the same access as a list, and each write one
   * field's value or the type of one issue (gh.ts isFieldValueSet, isIssueTypeSet).
   */
  readonly fields: IssueFields = {
    read: async (repo: string): Promise<HostFieldRead> => {
      const access = await this.tokens.accessFor(repo);
      return access instanceof NoAccessError ? { kind: 'failed', reason: access.message } : readFields(this.gh, access, repo);
    },
    setField: (target: IssueTarget, field: HostField, value: FieldValue): Promise<HostEnd> =>
      this.write(target, { args: fieldValueSetArgs(target, field.id, value) }, `set the field ${JSON.stringify(field.name)} of`),
    setType: (target: IssueTarget, type: string): Promise<HostEnd> => this.write(target, { args: issueTypeSetArgs(target, type) }, 'set the type of'),
  };

  /**
   * A search of one repository: one page of GitHub's issue search per kind through its allowlisted read (gh.ts
   * isIssueSearch), with the repository's own access. GitHub searches one kind at a time, so both kinds are the
   * issues' page then the pull requests', and the first failure fails the whole. The words go as quoted terms
   * (gh.ts searchTerms), so GitHub reads none as its own syntax; words naming another repository, owner or user, or
   * holding nothing but double quotes, are refused unsent.
   */
  readonly search: IssueSearch = {
    searchIssues: async (repo: string, query: IssueQuery): Promise<HostSearch> => {
      if (widensSearch(query.words)) {
        return { kind: 'failed', reason: 'a search stays in its repository: its words may not name a repo:, org:, user: or owner: qualifier' };
      }
      if (searchTerms(query.words) === '') {
        return { kind: 'failed', reason: 'the words hold nothing to look for once their double quotes are dropped' };
      }
      const kinds: readonly SearchKind[] = query.kind === 'all' ? ['issue', 'pull'] : [query.kind];
      const issues: FoundIssue[] = [];
      let more = false;
      for (const kind of kinds) {
        const page = await this.searchPage(repo, { ...query, kind });
        if (page.kind === 'failed') {
          return page;
        }
        issues.push(...page.issues);
        more ||= page.more;
      }
      return { kind: 'found', issues, more };
    },
  };

  /** One page of one kind's search of `repo` (search). */
  private async searchPage(repo: string, query: Omit<IssueQuery, 'kind'> & { readonly kind: SearchKind }): Promise<HostSearch> {
    const read = await this.read(repo, issueSearchArgs(repo, query), `the issues of ${repo}`);
    if (read.kind !== 'found') {
      return read.kind === 'missing' ? { kind: 'failed', reason: `GitHub shows no repository ${repo} to search, or the access may not see it` } : read;
    }
    const page = searchIn(repo, read.stdout);
    return page === undefined ? { kind: 'failed', reason: `gh printed no search answer for ${repo}` } : { kind: 'found', ...page };
  }

  async watch(repo: string, marks: WatchMarks): Promise<HostWatch> {
    const access = await this.tokens.accessFor(repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    const next = new Map(marks);
    let changed = false;
    let failure: string | undefined;
    for (const path of WATCH_PATHS) {
      const answer = await this.probe(repo, path, marks.get(path), access.env);
      if (answer.kind === 'changed') {
        changed = true;
        if (answer.tag === undefined) {
          next.delete(path);
        } else {
          next.set(path, answer.tag);
        }
      } else if (answer.kind === 'failed') {
        failure ??= `${repo} ${path.slice(0, path.indexOf('?'))}: ${answer.reason}`;
      }
    }
    if (changed) {
      return { kind: 'changed', marks: next };
    }
    return failure === undefined ? { kind: 'unchanged' } : { kind: 'failed', reason: this.scanner.redact(failure) };
  }

  private async probe(repo: string, path: WatchPath, tag: string | undefined, env: Env): Promise<ProbeAnswer> {
    try {
      return probeAnswerOf(await this.gh.run({ args: watchProbeArgs(repo, path, tag), env }));
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
  }

  unassign(target: IssueTarget, login: string): Promise<HostEnd> {
    return this.write(target, { args: issueUnassignArgs(target, login) }, `take ${login} off the assignees of`);
  }

  /**
   * Reads where one pull request stands (pull-stand.ts), for `pr approve` and `pr merge` (T4817): read, missing when
   * GitHub answers Not Found or null, else failed with gh's own line or when the answer has no pull request's shape.
   */
  async pullStand(target: IssueTarget): Promise<HostPullStand> {
    const shown = targetText(target);
    const read = await this.read(target.repo, pullStandArgs(target), `where ${shown} stands`);
    if (read.kind !== 'found') {
      return read;
    }
    const answer = pullStandIn(read.stdout);
    return answer.kind === 'unreadable' ? { kind: 'failed', reason: `gh printed no pull request for ${shown}` } : answer;
  }

  /**
   * The commits `head` carries over `base` (T5117): the compare's list, then each commit read for its files' patches.
   * Partial when GitHub lists fewer commits than the head carries, more than COMPARE_COMMITS_MAX, or a commit at
   * COMMIT_FILES_MAX files; missing on Not Found; failed on any other end or an answer off its shape.
   */
  async pullWork(target: IssueTarget, base: string, head: string): Promise<HostPullWork> {
    const shown = `${head.slice(0, 9)} over ${base} in ${target.repo}`;
    if (!BASE_BRANCH.test(base)) {
      return { kind: 'partial', reason: `the branch name ${base} is not one a compare read takes` };
    }
    const read = await this.read(target.repo, pullCompareArgs(target.repo, base, head), `the commits of ${shown}`);
    if (read.kind !== 'found') {
      return read;
    }
    const compare = compareIn(read.stdout);
    if (compare === undefined) {
      return { kind: 'failed', reason: `gh printed no compare for ${shown}` };
    }
    if (compare.total > compare.shas.length || compare.total > COMPARE_COMMITS_MAX) {
      return { kind: 'partial', reason: `${shown} carries ${String(compare.total)} commits, more than one landing compares (${String(Math.min(compare.shas.length, COMPARE_COMMITS_MAX))})` };
    }
    const commits: HostCommit[] = [];
    for (const sha of compare.shas) {
      const one = await this.read(target.repo, commitReadArgs(target.repo, sha), `the commit ${sha.slice(0, 9)} of ${target.repo}`);
      if (one.kind !== 'found') {
        return one.kind === 'missing' ? { kind: 'failed', reason: `GitHub listed the commit ${sha.slice(0, 9)} of ${shown} but no longer shows it` } : one;
      }
      const commit = commitIn(one.stdout);
      if (commit === undefined) {
        return { kind: 'failed', reason: `gh printed no commit ${sha.slice(0, 9)} of ${target.repo}` };
      }
      if (commit.files.length >= COMMIT_FILES_MAX) {
        return { kind: 'partial', reason: `the commit ${sha.slice(0, 9)} changes ${String(COMMIT_FILES_MAX)} files or more, more than GitHub lists in one read` };
      }
      commits.push(commit);
    }
    return { kind: 'read', commits };
  }

  /** Approves the pull request at `head` (a full sha), with gh.ts approvalBody as the review's text. */
  approvePull(target: IssueTarget, head: string): Promise<HostEnd> {
    return this.write(target, { args: pullApproveArgs(target, head) }, 'approve');
  }

  /**
   * Lands the pull request as `pull` read it, pinned to its head: enqueued where the repository has a merge queue,
   * else merged by rebase. GitHub refuses either when the head moved since the read, and keeps its own required checks.
   */
  async landPull(target: IssueTarget, pull: PullStand): Promise<HostLanding> {
    const queue = pull.mergeQueue;
    const args = queue ? pullEnqueueArgs(pull.id, pull.head) : pullMergeArgs(target, pull.head);
    const end = await this.write(target, { args }, queue ? 'add to the merge queue' : 'merge');
    return end.kind === 'failed' ? end : { kind: queue ? 'enqueued' : 'merged' };
  }

  /** One write; `missing`, when given, says what a Not Found means for it in place of the issue not being there. */
  private async write(target: IssueTarget, call: GhCall, what: string, missing?: string): Promise<HostEnd> {
    const access = await this.tokens.accessFor(target.repo);
    if (access instanceof NoAccessError) {
      return { kind: 'failed', reason: access.message };
    }
    let result: GhResult;
    try {
      result = await this.gh.run({ ...call, env: access.env });
    } catch (error) {
      return { kind: 'failed', reason: startFailureText(error) };
    }
    if (result.end.kind === 'signal') {
      return { kind: 'failed', reason: `gh was stopped (${result.end.signal}) on its way to ${what} ${targetText(target)}: look on GitHub before a rerun` };
    }
    if (result.end.code !== 0) {
      const notThere = missing !== undefined && ghFailureKind(result.end.code, result.stderr) === 'not-visible';
      return { kind: 'failed', reason: notThere ? missing : this.scanner.redact(writeFailureText(target, what, result.end.code, result.stderr, access)) };
    }
    return { kind: 'done' };
  }
}

/** What a reader of the sync should know about one list: it may be cut short, or gh printed items it could not read. */
function listNotes(state: IssueState, list: Extract<IssueList, { kind: 'listed' }>): string[] {
  return [
    ...(list.full ? [`the ${state} list reached ${ISSUE_LIMIT} issues, so it may leave some out`] : []),
    ...(list.unreadable > 0 ? [`${list.unreadable} ${state} item(s) gh printed did not read as issues and were left out`] : []),
  ];
}

/** Why a write failed, with the fix when it is a known one: a refused token, a missing permission, an issue not there. */
export function writeFailureText(target: IssueTarget, what: string, code: number, stderr: string, access: RepoAccess): string {
  const shown = targetText(target);
  const token = `the token saved as ${access.credential}`;
  switch (ghFailureKind(code, stderr)) {
    case 'unreachable':
      return unreachableText(token);
    case 'no-login':
      return `GitHub refused ${token} (expired or revoked?): create a new one and save it again with: ${access.save}`;
    case 'no-permission':
      return `${token} may not ${what} ${shown}: on GitHub, edit that token and set Issues and Pull requests to Read and write; its text stays the same, so nothing needs saving again`;
    case 'not-visible':
      return `${shown} is not there for ${token}: check the number, and that the token reaches ${target.repo}`;
    case undefined:
      return plainLine(`gh api to ${what} ${shown} ${exitText(code, stderr)}`);
  }
}

/** Why a run's re-run failed, with the fix when it is a known one: a refused token, a missing Actions write, no such run. */
export function rerunFailureText(repo: string, runId: number, code: number, stderr: string, access: RepoAccess): string {
  const shown = `run ${String(runId)} of ${repo}`;
  const token = `the token saved as ${access.credential}`;
  switch (ghFailureKind(code, stderr)) {
    case 'unreachable':
      return unreachableText(token);
    case 'no-login':
      return `GitHub refused ${token} (expired or revoked?): create a new one and save it again with: ${access.save}`;
    case 'no-permission':
      return `${token} may not re-run ${shown}: on GitHub, edit that token and set Actions to Read and write; its text stays the same, so nothing needs saving again`;
    case 'not-visible':
      return `${shown} is not there for ${token}: check the run id (the number after /runs/ in its address), and that the token reaches ${repo}`;
    case undefined:
      return plainLine(`gh api to re-run ${shown} ${exitText(code, stderr)}`);
  }
}

/** What one read gave: found with what gh printed, missing on Not Found, or failed with the reason. */
type HostRead = { readonly kind: 'found'; readonly stdout: string } | { readonly kind: 'missing' } | { readonly kind: 'failed'; readonly reason: string };

/** The `login` of a user as `gh api users/<login>` prints it, when it has a login's shape; else undefined. */
export function loginIn(stdout: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('login' in parsed)) {
    return undefined;
  }
  const { login } = parsed;
  return typeof login === 'string' && isLogin(login) ? login : undefined;
}

/**
 * An issue or pull request as GitHub's REST API prints it (`state` open or closed, `labels` of names, `assignees` of
 * logins, a `pull_request` field on a pull request only, `body` null when empty, its `title`), else undefined.
 */
export function threadIn(stdout: string): IssueThread | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { state, labels, assignees, body, title } = parsed;
  const names = namesIn(labels, 'name');
  const logins = namesIn(assignees, 'login');
  if ((state !== 'open' && state !== 'closed') || names === undefined || logins === undefined || (body !== null && body !== undefined && typeof body !== 'string')) {
    return undefined;
  }
  const pull = parsed['pull_request'];
  return { state, labels: names, assignees: logins, pull: pull !== undefined && pull !== null, body: body ?? '', ...(typeof title === 'string' ? { title } : {}) };
}

/** The string `key` of each record of a REST list, or undefined when it is no list or one item has none. */
function namesIn(list: unknown, key: string): string[] | undefined {
  if (!Array.isArray(list)) {
    return undefined;
  }
  const names: string[] = [];
  for (const item of list) {
    const name: unknown = isRecord(item) ? item[key] : undefined;
    if (typeof name !== 'string') {
      return undefined;
    }
    names.push(name);
  }
  return names;
}

/** The `id` of an issue as GitHub's REST API prints it: a positive safe integer, else undefined. */
export function issueIdIn(stdout: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('id' in parsed)) {
    return undefined;
  }
  const { id } = parsed;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/**
 * The names of the labels of an issue as GitHub's REST API prints it: its `labels` list, each an object with a
 * `name` string. Undefined when the answer holds no such list.
 */
export function labelNamesIn(stdout: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('labels' in parsed)) {
    return undefined;
  }
  const list: unknown = parsed.labels;
  if (!Array.isArray(list)) {
    return undefined;
  }
  const items: readonly unknown[] = list;
  const names: string[] = [];
  for (const label of items) {
    if (typeof label !== 'object' || label === null || !('name' in label) || typeof label.name !== 'string') {
      return undefined;
    }
    names.push(label.name);
  }
  return names;
}
