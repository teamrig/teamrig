import { type CatchUp, type CatchUpDeps, ownDiff } from './catch-up.ts';
import { mainMovedPast } from './sync.ts';

/**
 * Brings the release pull request's head up to a main that moved past it by commits its changelog hides, for
 * `ship.ts merge --release` (T5055). release-please rewrites its head only when its notes or version would change: a
 * main that gained only `ci:` or `refactor:` commits leaves the head as it was, so a merge that waited for the rewrite
 * refused forever. When every commit main gained past the head is a type release-please's changelog hides, with no
 * breaking change, no `Release-As` footer and no edit of its config or manifest, the head release-please would write
 * on that main is its head rebased: this rebases it there, holds its diff equal to the one approved (catch-up.ts
 * `ownDiff`), and pushes it to the same branch and pull request with a lease on the approved sha, so a head
 * release-please wrote meanwhile is never overwritten. Its checks then run as any head's. Any other move is refused,
 * as release-please must write the notes it adds.
 */

/**
 * The Conventional types release-please's default changelog sections hide (its `DEFAULT_CHANGELOG_SECTIONS`); every
 * other type (feat, fix, perf, revert, deps, any unknown one) shows, so a move by it rewrites the notes.
 */
export const HIDDEN_TYPES: ReadonlySet<string> = new Set(['docs', 'style', 'chore', 'refactor', 'test', 'build', 'ci']);

/** release-please's config, which says how its changelog reads. */
const CONFIG = 'release-please-config.json';

/** release-please's own files: a move that edits either may change what it writes, whatever the commit's type. */
export const RELEASE_TOOL_FILES: readonly string[] = [CONFIG, '.release-please-manifest.json'];

/** The separators of `git log`'s fields and records (git's %x1f and %x1e), which no commit message holds. */
const FIELD = '\x1f';
const RECORD = '\x1e';

/** `git log`'s format of one commit: its sha and message, split by FIELD, ended by RECORD. */
const LOG_FORMAT = '--format=%H%x1f%B%x1e';

/** A Conventional Commits header: the type, an optional scope, an optional `!` for a breaking change, then the text. */
const HEADER = /^(?<type>[A-Za-z]+)(?:\([^()\r\n]*\))?(?<breaking>!)?: \S/;

/** A footer that makes release-please write another version or a breaking change's notes. */
const RELEASE_FOOTER = /^(?:BREAKING[ -]CHANGE|Release-As)\s*:/im;

/** Why `message`'s commit changes what release-please writes, or null when its changelog hides it. */
function shownBy(message: string): string | null {
  const [header = ''] = message.split('\n');
  const parsed = HEADER.exec(header)?.groups;
  if (parsed === undefined) return 'it is not a Conventional Commits subject, so which section it falls in is not known here';
  const type = (parsed['type'] ?? '').toLowerCase();
  if (parsed['breaking'] !== undefined) return 'it is a breaking change, which the changelog always shows';
  if (RELEASE_FOOTER.test(message)) return 'it carries a BREAKING CHANGE or Release-As footer, which changes the release';
  return HIDDEN_TYPES.has(type) ? null : `its type ${type} shows in the changelog`;
}

/**
 * Why main's move from the release head `sha` to `tip` may change what release-please writes, or null when every
 * commit `sha..tip` holds is one its changelog hides and none edits its config or manifest. A repo whose release
 * config sets its own `changelog-sections` is refused too: only the default sections are known here.
 */
export function releaseMoveRefusal(git: CatchUpDeps['git'], sha: string, tip: string): string | null {
  let config: string;
  try {
    config = git('cat-file', 'blob', `${tip}:${CONFIG}`);
  } catch {
    return `${tip.slice(0, 7)} has no ${CONFIG}, so which commits its changelog hides is not known here`;
  }
  if (config.includes('"changelog-sections"')) return `${CONFIG} sets its own changelog-sections, and only release-please's default ones are known here`;
  const records = git('log', LOG_FORMAT, `${sha}..${tip}`)
    .split(RECORD)
    .map((record) => record.trim())
    .filter((record) => record !== '');
  for (const record of records) {
    const [commit = '', message = ''] = record.split(FIELD);
    const why = shownBy(message.trim());
    if (why !== null) return `${commit.slice(0, 9)} "${message.trim().split('\n')[0] ?? ''}" may change the release notes: ${why}`;
  }
  const touched = git('log', '--format=%H', `${sha}..${tip}`, '--', ...RELEASE_TOOL_FILES);
  if (touched !== '') return `${touched.split('\n')[0]?.slice(0, 9) ?? ''} edits ${RELEASE_TOOL_FILES.join(' or ')}, which may change what release-please writes`;
  return null;
}

export interface ReleaseCatchUpRequest {
  /** The release pull request's branch on origin. */
  readonly head: string;
  /** Its head as cleared on the release task's approval: the push leases on it. */
  readonly sha: string;
  /** main's tip on origin, which `sha` does not contain. */
  readonly tip: string;
  /** The branch merged into. */
  readonly main: string;
}

/** The repo dir's checkout before the catch-up, to switch back to: its branch, else its detached sha. */
function checkoutOf(git: CatchUpDeps['git']): readonly string[] {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  return branch === 'HEAD' ? ['--detach', git('rev-parse', 'HEAD')] : [branch];
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Rebases the release head onto main's tip in the repo dir, on a detached HEAD so no local branch changes, and pushes
 * it to the release branch with a lease on `request.sha`, the repo dir then back on what it had checked out. The
 * pre-push gate proves the pushed tree there, as it is checked out (local-gate.ts `provePush`).
 */
export function catchUpRelease(deps: Pick<CatchUpDeps, 'git' | 'log'>, request: ReleaseCatchUpRequest): CatchUp {
  const { git, log } = deps;
  const { head, sha, tip, main } = request;
  const past = `${main} moved to ${tip.slice(0, 7)}, which the release pull request's head ${sha.slice(0, 7)} does not contain`;
  const refuse = (why: string): CatchUp => ({ kind: 'refused', reason: `${past}, and ${why}` });
  const moves = releaseMoveRefusal(git, sha, tip);
  if (moves !== null) return refuse(`${moves}: the release tool rewrites that head, so once its new head's checks pass, ask approval of that head and merge again`);
  if (git('status', '--porcelain') !== '') return refuse('the repo dir has uncommitted changes: commit them or set them aside, then merge again');

  const back = checkoutOf(git);
  const restore = (): void => {
    git('switch', '--quiet', ...back);
  };
  const own = ownDiff(git, git('merge-base', sha, tip), sha);
  git('switch', '--quiet', '--detach', sha);
  try {
    git('rebase', '--quiet', tip);
  } catch {
    git('rebase', '--abort');
    restore();
    return refuse('rebasing it onto that tip conflicts: the release tool must write it again');
  }
  const rebased = git('rev-parse', 'HEAD');
  if (ownDiff(git, tip, rebased) !== own) {
    restore();
    return refuse('its diff changes when rebased onto that tip: the release tool must write it again');
  }
  try {
    git('push', '--quiet', `--force-with-lease=refs/heads/${head}:${sha}`, 'origin', `HEAD:refs/heads/${head}`);
  } catch (error) {
    const moved = movedAgain(git, main);
    restore();
    if (moved === null) return refuse(`pushing it rebased to ${head} failed: ${messageOf(error)}`);
    return { kind: 'moved', tip: moved.tip, reason: `the release pull request's head ${sha.slice(0, 7)} was caught up, and ${main} moved again to ${moved.tip.slice(0, 7)} while it was pushed: ${messageOf(error)}` };
  }
  restore();
  log(`${past}, only by commits its changelog hides: rebased it with the same diff and pushed it to ${head} ${rebased.slice(0, 7)}; merging that`);
  return { kind: 'rebased', head, sha: rebased };
}

/** main's move past the rebased head checked out, read after its push failed; null when main holds still or cannot be read. */
function movedAgain(git: CatchUpDeps['git'], main: string): ReturnType<typeof mainMovedPast> {
  try {
    return mainMovedPast(git, main);
  } catch {
    return null;
  }
}
