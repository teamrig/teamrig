import type { CliRuntime } from '../cli/runtime.ts';
import { FakeChangeGit } from './fake-change-git.ts';
import { FakeMergeGit } from './fake-merge-git.ts';
import { FakePullGit } from './fake-pull-git.ts';
import { noWorktrees } from './fake-worktrees.ts';

/** The git parts of a run's outside world: the repo, its commits, worktrees and the trees merge and pre-push read. */
export type GitWorld = Pick<
  CliRuntime,
  'git' | 'pointerGit' | 'commitLog' | 'secretsGit' | 'worktrees' | 'trees' | 'mergeGit' | 'pulls' | 'changeGit'
>;

/**
 * Git when a run does not care about it: the repo on `branch` with no push target or config, a team pointer outside
 * git, no commits in any range, no repository the secret scan can read, no worktrees, merge finds only the fake
 * repository at /w/feat (testing/fake-merge-git.ts), a pre-push check no repository and a change read no history.
 */
export function quietGit(branch: string): GitWorld {
  return {
    git: { branch: () => branch, head: () => undefined, pushTarget: () => undefined, config: () => ({ kind: 'unset' }) },
    pointerGit: { state: () => ({ kind: 'no-git' }) },
    commitLog: { between: () => [] },
    secretsGit: {
      root: () => undefined,
      staged: () => undefined,
      isCommit: () => false,
      commits: () => undefined,
      tagMessages: () => undefined,
      hooksDir: () => undefined,
      blob: () => undefined,
    },
    worktrees: noWorktrees(),
    trees: { checked: () => ({ kind: 'none' }), ranIn: () => ({ kind: 'outside' }) },
    mergeGit: new FakeMergeGit(),
    pulls: new FakePullGit(),
    changeGit: new FakeChangeGit(),
  };
}
