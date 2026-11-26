import { plainLine } from '../core/printable.ts';
import { targetText, type HostAccess, type IssueDraft, type IssueStore, type Labels } from './host.ts';

/**
 * Opens one issue through `host`, one line said for each step: ACCESS, then OPENED with the new issue and its title,
 * or FAILED with the reason. Each label must already be one of the repository's, read before the open, since a host
 * may make a label it is handed that it lacks (GitHub does), so a typo never makes a new one; the labels go by the
 * names the tracker holds them under. The caller has checked the title, the body and each label name. True when the
 * issue opened.
 */
export async function openIssue(host: HostAccess & IssueStore & Labels, draft: IssueDraft, say: (line: string) => void): Promise<boolean> {
  const { repo } = draft;
  const reach = await host.reach(repo, 'open');
  if (reach.kind === 'unreachable') {
    say(`FAILED ${repo}: ${reach.reason}; nothing was opened`);
    return false;
  }
  say(`ACCESS ${reach.access}`);
  const labels = draft.labels.map((label) => host.labelName(label));
  for (const label of labels) {
    const found = await host.labelExists(repo, label);
    if (found.kind === 'failed') {
      say(`FAILED ${repo}: ${found.reason}; nothing was opened`);
      return false;
    }
    if (found.kind !== 'found') {
      say(`FAILED ${repo}: it has no label ${JSON.stringify(label)}; make it there first, as opening with it here would make a new one; nothing was opened`);
      return false;
    }
  }
  const opened = await host.open({ ...draft, labels });
  if (opened.kind === 'failed') {
    say(`FAILED ${repo}: ${opened.reason}`);
    return false;
  }
  say(`OPENED ${targetText(opened.target)}: ${plainLine(draft.title)}`);
  return true;
}
