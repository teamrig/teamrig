/**
 * Pushes the checked-out change branch for `ship.ts --merge` (T629), never main: the auto-mode briefing grants
 * the teamrig session pushes of its own non-main branches, and main only moves through merge.ts.
 *
 * A branch pushed before and since rebased onto main (sync.ts for a ship, catch-up.ts for a merge) no longer
 * fast-forwards, so the push replaces it on the same branch and pull request (the owner's rule of 11-21: never a new
 * branch) with a lease: on `expected`, the sha the caller rebased from, when it knows it; else on the sha origin had
 * when this push began. Anything else that wrote the branch since makes the push fail instead of being lost.
 */

const MERGED_INTO = ['main', 'master'];

export function pushOwnBranch(git: (...args: string[]) => string, main: string, expected?: string): string {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'HEAD') throw new Error('REFUSED the repo dir has a detached HEAD: check out the change branch');
  if (branch === main || MERGED_INTO.includes(branch)) throw new Error(`REFUSED ${branch} is a branch changes merge into: ship a change branch`);
  const [pushed = ''] = expected === undefined ? git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`).split('\t') : [expected];
  const lease = pushed === '' ? [] : [`--force-with-lease=refs/heads/${branch}:${pushed}`];
  git('push', '--quiet', ...lease, 'origin', `HEAD:refs/heads/${branch}`);
  return branch;
}
