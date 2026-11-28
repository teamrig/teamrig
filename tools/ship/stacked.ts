import { isRegenerated, parseLog } from './leftovers.ts';

/**
 * Where a branch stacked on a parent branch starts its own work, once the parent merged first (T3343). Main then holds
 * the parent's work under new shas, while the branch still carries it under the old ones, followed by the parent's
 * raise and dist commits. A catch-up that replays from the merge base would pick the parent's work again (an empty
 * pick, refused) and hold the parent's lines as the branch's own diff; it replays from the parent's tip instead.
 *
 * The parent's part is a run at the start of `base..sha`: commits whose patch main's side already holds (`git cherry`,
 * patch ids as git reads them), and commits that change only regenerated paths (its raise and dist, made again on
 * main). The branch's own work starts at the first commit that is neither. A landed commit after that is refused:
 * dropping it there would change what the branch's own commits sit on, which a hand rebase must settle.
 */
export type Stacked =
  | { readonly kind: 'none' }
  | { readonly kind: 'parent'; readonly tip: string; readonly landed: readonly string[] }
  | { readonly kind: 'refused'; readonly why: string };

type Git = (...args: string[]) => string;

/** The commits of `base..sha` whose patch `tip`'s side of their merge base holds already, oldest first. */
function landedOf(git: Git, base: string, sha: string, tip: string): Set<string> {
  const rows = git('cherry', tip, sha, base).split('\n').map((row) => row.trim());
  return new Set(rows.filter((row) => row.startsWith('- ')).map((row) => row.slice(2)));
}

export function stackedOn(git: Git, regenerated: readonly string[], base: string, sha: string, tip: string): Stacked {
  const landed = landedOf(git, base, sha, tip);
  if (landed.size === 0) return { kind: 'none' };
  const commits = parseLog(git('log', '--reverse', '--format=%x00%H %P', '--name-only', `${base}..${sha}`));
  const onlyRegenerated = (files: readonly string[]): boolean => files.length > 0 && files.every((file) => isRegenerated(file, regenerated));
  const own = commits.findIndex((commit) => !landed.has(commit.sha) && !onlyRegenerated(commit.files));
  const parentPart = own === -1 ? commits : commits.slice(0, own);
  const late = commits.slice(parentPart.length).find((commit) => landed.has(commit.sha));
  if (late !== undefined) {
    return { kind: 'refused', why: `its commit ${late.sha.slice(0, 9)} is on main already but follows the branch's own work: rebase it by hand, push it under a new name and merge that` };
  }
  const last = parentPart.at(-1);
  if (own <= 0 || last === undefined) return { kind: 'none' };
  return { kind: 'parent', tip: last.sha, landed: parentPart.filter((commit) => landed.has(commit.sha)).map((commit) => commit.sha) };
}
