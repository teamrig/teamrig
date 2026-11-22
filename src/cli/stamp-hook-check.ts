import type { CommitsConfig, DeliveryConfig } from '../config/types.ts';
import type { Files } from '../core/files.ts';
import { KIT_NAME, type TeamPaths } from '../core/home.ts';
import type { HookLine } from '../git-hooks/hook-lines.ts';
import type { SecretsGit } from '../secret-guard/secrets-git.ts';
import { hookLineWarnings, type HookLineCheck } from './hook-line-check.ts';
import type { UnownedWarning } from './unowned.ts';

/**
 * The commit-msg line that stamps each commit with the teamrig, program, model and effort that made it (T4869). It
 * ends `|| true`: a stamp that fails never blocks a commit.
 */
export const STAMP_HOOKS: readonly HookLine[] = [
  { hook: 'commit-msg', command: 'stamp', sub: 'commit', line: `${KIT_NAME} stamp commit "$1" || true` },
];

/** A repository git cannot read is passed over here: SECRET-HOOK already names it. */
const STAMP_HOOK_CHECK: HookLineCheck = {
  flag: 'STAMP-HOOK',
  source: 'the stamp hook check [delivery.repos, commits.stamp]',
  lines: STAMP_HOOKS,
  missing: (scripts, missing, adds) => `(${scripts}) runs no commit stamp in ${missing.map((hook) => hook.hook).join(', ')}, so its commits do not name the program, model and effort that made them: add ${adds}`,
};

/**
 * STAMP-HOOK (T4869), for `check`: while `commits.stamp` is on, each repository the team merges into
 * (`delivery.repos`) whose commit-msg script does not call `teamrig stamp commit`; none while it is off.
 */
export async function stampHookWarnings(files: Files, git: SecretsGit, paths: Pick<TeamPaths, 'home'>, config: { readonly delivery: Pick<DeliveryConfig, 'repos'>; readonly commits: Pick<CommitsConfig, 'stamp'> }): Promise<UnownedWarning[]> {
  return config.commits.stamp ? hookLineWarnings(files, git, paths, config.delivery.repos, STAMP_HOOK_CHECK) : [];
}
