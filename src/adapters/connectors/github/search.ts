import { isRecord, stringField, type FoundIssue } from '../../../plugin-api/index.ts';

/** What one page of GitHub's issue search gave: the items that read, and whether the search holds more. */
export interface SearchPage {
  readonly issues: readonly FoundIssue[];
  readonly more: boolean;
}

/**
 * Whether an item's `repository_url` (`https://api.github.com/repos/<owner>/<name>`) is `repo`'s, case aside as
 * GitHub's names are. The query keeps a search to `repo`, but the item is checked too, so the scope never rests on
 * how GitHub parses the words alone.
 */
function isOfRepo(repo: string, item: Readonly<Record<string, unknown>>): boolean {
  const url = stringField(item, 'repository_url');
  return url !== undefined && url.toLowerCase().endsWith(`/repos/${repo.toLowerCase()}`);
}

/**
 * One item of the search as GitHub's REST API prints it (`number`, `title`, `state` open or closed, `repository_url`,
 * a `pull_request` field on a pull request only), as a found issue of `repo`; undefined when it does not read as one
 * or is another repository's.
 */
function foundIn(repo: string, item: unknown): FoundIssue | undefined {
  if (!isRecord(item) || !isOfRepo(repo, item)) {
    return undefined;
  }
  const { number, state } = item;
  const title = stringField(item, 'title');
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || (state !== 'open' && state !== 'closed') || title === undefined) {
    return undefined;
  }
  const pull = item['pull_request'];
  return { target: { repo, number }, title, state, pull: pull !== undefined && pull !== null };
}

/**
 * One page of a search of `repo` as gh printed it (`total_count` and a list of `items`), else undefined. The search
 * was kept to `repo` by its query (gh.ts isIssueSearch), and each item's own repository is checked again; an item
 * that does not read, or is another repository's, is left out, never guessed, and `more` counts it, so the reader
 * knows the page is not all there is.
 */
export function searchIn(repo: string, stdout: string): SearchPage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const total = parsed['total_count'];
  const items = parsed['items'];
  if (typeof total !== 'number' || !Array.isArray(items)) {
    return undefined;
  }
  const issues: FoundIssue[] = [];
  for (const item of items) {
    const found = foundIn(repo, item);
    if (found !== undefined) {
      issues.push(found);
    }
  }
  return { issues, more: total > issues.length };
}
