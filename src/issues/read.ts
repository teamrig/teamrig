import { plainLine, printable } from '../core/printable.ts';
import { targetText, type IssueQuery, type IssueTarget, type Tracker } from './host.ts';

/** How one read of a tracker ended: printed, the host had nothing to give, or it failed; each after its lines were said. */
export type ReadEnd = 'read' | 'missing' | 'failed';

/** What a search line names a state and kind as: `open issue`, `closed pull`. */
function kindText(pull: boolean): string {
  return pull ? 'pull' : 'issue';
}

/** The query's state and kind as the FOUND line names them: `open issues`, `issues and pulls of any state`. */
function scopeText(query: IssueQuery): string {
  const kinds = query.kind === 'all' ? 'issues and pulls' : `${query.kind}s`;
  return query.state === 'all' ? `${kinds} of any state` : `${query.state} ${kinds}`;
}

/**
 * Searches `repo` through the tracker's search, one line said for each step: ACCESS, then FOUND with one line per
 * issue (`#12 open issue <title>`) in the tracker's own order, or FAILED. Titles are outside text: each prints on one
 * plain line. A tracker with no search (a connector before plugin API 0.3.0) fails before anything is read.
 */
export async function searchIssues(tracker: Tracker, repo: string, query: IssueQuery, say: (line: string) => void): Promise<ReadEnd> {
  const search = tracker.search;
  if (search === undefined) {
    say(`FAILED ${repo}: its tracker has no issue search (plugin API 0.3.0 adds it); nothing was read`);
    return 'failed';
  }
  const reach = await tracker.reach(repo, 'read');
  if (reach.kind === 'unreachable') {
    say(`FAILED ${repo}: ${reach.reason}; nothing was read`);
    return 'failed';
  }
  say(`ACCESS ${reach.access}`);
  const found = await search.searchIssues(repo, query);
  if (found.kind === 'failed') {
    say(`FAILED ${repo}: ${found.reason}`);
    return 'failed';
  }
  const words = JSON.stringify(plainLine(query.words));
  const more = found.more ? '; the tracker holds more: narrow the words' : '';
  say(`FOUND ${repo}: ${found.issues.length === 0 ? 'none' : String(found.issues.length)} of the ${scopeText(query)} matching ${words}${more}`);
  for (const issue of found.issues) {
    say(`#${issue.target.number} ${issue.state} ${kindText(issue.pull)} ${plainLine(issue.title)}`);
  }
  return 'read';
}

/**
 * Reads one issue or pull request, one line said for each step: ACCESS, then its state and kind, title, labels,
 * assignees and the body under a BODY line; or MISSING or FAILED. All of it is outside text: the title, labels and
 * assignees print on one plain line each, and each body line with its control and format characters escaped, so the
 * body cannot add a line that reads as one of these.
 */
export async function showIssue(tracker: Tracker, target: IssueTarget, say: (line: string) => void): Promise<ReadEnd> {
  const shown = targetText(target);
  const reach = await tracker.reach(target.repo, 'read');
  if (reach.kind === 'unreachable') {
    say(`FAILED ${shown}: ${reach.reason}; nothing was read`);
    return 'failed';
  }
  say(`ACCESS ${reach.access}`);
  const read = await tracker.thread(target);
  if (read.kind === 'missing') {
    say(`MISSING ${shown}: the tracker shows no such issue or pull request to this access`);
    return 'missing';
  }
  if (read.kind === 'failed') {
    say(`FAILED ${shown}: ${read.reason}`);
    return 'failed';
  }
  const { thread } = read;
  say(`SHOW ${shown}: ${thread.state} ${kindText(thread.pull)}`);
  say(`TITLE ${plainLine(thread.title ?? '')}`);
  say(`LABELS ${listText(thread.labels)}`);
  say(`ASSIGNEES ${thread.assignees.length === 0 ? 'none' : thread.assignees.map(plainLine).join(', ')}`);
  say(thread.body === '' ? 'BODY none' : 'BODY');
  if (thread.body !== '') {
    for (const line of thread.body.replace(/\r\n/gu, '\n').split('\n')) {
      say(`  ${printable(line)}`);
    }
  }
  return 'read';
}

/** Labels on one line, each plain and quoted, as issue label prints them; `none` for an empty list. */
function listText(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.map((name) => JSON.stringify(plainLine(name))).join(', ');
}
