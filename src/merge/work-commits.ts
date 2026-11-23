/** One commit a branch carries over its base. */
export interface WorkCommit {
  readonly sha: string;
  readonly subject: string;
  /** A merge commit, whose own changes no patch shows. */
  readonly merge: boolean;
  /**
   * The commit's patch id, like `git patch-id` (what `git range-diff` marks `=`): a hash of its diff with hunk
   * positions and blob ids dropped, so a rebase over other lines keeps it, while any change to its lines moves it.
   * Empty for a merge commit. Two ids compare only when one reader made both.
   */
  readonly patch: string;
}

const named = (commit: WorkCommit): string => `${commit.sha.slice(0, 9)} "${commit.subject}"`;

/**
 * How `head`'s work commits differ from `approved`'s, each change named (changed, dropped, added, reordered); empty
 * when they are the same patches in the same order, all a rebase leaves that `git range-diff` marks `=` throughout.
 * A merge commit on either side always differs: its own changes have no patch to compare.
 */
export function workChanges(approved: readonly WorkCommit[], head: readonly WorkCommit[]): string[] {
  const merges = [...approved, ...head].filter((commit) => commit.merge).map((commit) => `merge commit ${named(commit)}: rebase it away`);
  const unmatched = head.filter((commit) => !commit.merge);
  const missing: WorkCommit[] = [];
  for (const commit of approved.filter((one) => !one.merge)) {
    const at = unmatched.findIndex((other) => other.patch === commit.patch);
    if (at === -1) missing.push(commit);
    else unmatched.splice(at, 1);
  }
  const changes = [...merges];
  for (const commit of missing) {
    const at = unmatched.findIndex((other) => other.subject === commit.subject);
    if (at === -1) {
      changes.push(`dropped ${named(commit)}`);
    } else {
      changes.push(`changed ${named(commit)}, now ${unmatched[at]?.sha.slice(0, 9) ?? ''}`);
      unmatched.splice(at, 1);
    }
  }
  changes.push(...unmatched.map((commit) => `added ${named(commit)}`));
  if (changes.length === 0 && approved.some((commit, i) => commit.patch !== head[i]?.patch)) {
    changes.push(`reordered, now ${head.map((commit) => commit.sha.slice(0, 9)).join(', ')}`);
  }
  return changes;
}
