import type { HostPullWork, IssueTarget, PullLanding, PullStand } from '../issues/host.ts';
import { hostWorkCommits } from './host-work.ts';
import { workChanges, type WorkCommit } from './work-commits.ts';

/**
 * Whether an approval of one pull request head carries to its live head (T5117): carried, with the approved head's
 * work commits counted; refused, naming why; or failed, when the code host could not be read.
 */
export type PullCarry =
  | { readonly kind: 'carried'; readonly commits: number }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/** A carry's end short of carried. */
type CarryEnd = Exclude<PullCarry, { readonly kind: 'carried' }>;

/** The work commits of one read, or the end that keeps a carry from resting on it. */
function workOf(read: HostPullWork, which: string): { readonly kind: 'work'; readonly commits: readonly WorkCommit[] } | CarryEnd {
  switch (read.kind) {
    case 'read':
      return { kind: 'work', commits: hostWorkCommits(read.commits) };
    case 'missing':
      return { kind: 'refused', reason: `the code host shows no commits of ${which}: an approval carries only to a head whose work it can read` };
    case 'partial':
      return { kind: 'refused', reason: `${read.reason}: an approval carries only over commits read whole` };
    case 'failed':
      return { kind: 'failed', reason: read.reason };
  }
}

/**
 * Whether the approval of `approved` (a full sha) carries to `pull`'s live head: only when the live head carries the
 * same work commits over the pull request's base, patch for patch and in the same order, as a rebase onto a newer base
 * leaves them (workChanges, the rule ship.ts merge holds its own branches to, T2913). Per commit, not the summed diff:
 * a rebase merge lands each commit, so a pair that adds then takes out a line would pass a summed check. Fails closed:
 * a head the host cannot read whole, an approved head with no work, or a merge commit on either side is refused.
 */
export async function pullCarry(landing: PullLanding, target: IssueTarget, pull: PullStand, approved: string): Promise<PullCarry> {
  const approvedRead = workOf(await landing.pullWork(target, pull.base, approved), `the approved head ${approved.slice(0, 9)} over ${pull.base}`);
  if (approvedRead.kind !== 'work') {
    return approvedRead;
  }
  if (approvedRead.commits.length === 0) {
    return { kind: 'refused', reason: `the approved head ${approved.slice(0, 9)} carries no commit over ${pull.base}: there is no work to carry` };
  }
  const liveRead = workOf(await landing.pullWork(target, pull.base, pull.head), `its head ${pull.head.slice(0, 9)} over ${pull.base}`);
  if (liveRead.kind !== 'work') {
    return liveRead;
  }
  const changes = workChanges(approvedRead.commits, liveRead.commits);
  return changes.length === 0
    ? { kind: 'carried', commits: approvedRead.commits.length }
    : { kind: 'refused', reason: `its head ${pull.head.slice(0, 7)} is not the approved ${approved.slice(0, 9)} rebased (${changes.join('; ')}): a head with other work needs its own approval` };
}
