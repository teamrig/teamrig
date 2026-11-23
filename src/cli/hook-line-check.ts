import type { DeliveryConfig } from '../config/types.ts';
import { teamPlace } from '../delivery/places.ts';
import type { Files } from '../core/files.ts';
import type { TeamPaths } from '../core/home.ts';
import { hookScriptsDir, missingHookLines, type HookLine } from '../git-hooks/hook-lines.ts';
import type { SecretsGit } from '../secret-guard/secrets-git.ts';
import type { UnownedWarning } from './unowned.ts';

/**
 * A `check` warning over the git hook scripts of each repository the team merges into: the hook lines it asks every
 * script to hold, and the warning's words. A repository's hooks are its own, not one session's area, so the warning
 * is one no session owns and goes to the lead.
 */
export interface HookLineCheck {
  /** The warning's flag, as `check` prints it: `SECRET-HOOK`. */
  readonly flag: string;
  /** The check that raised it, with the config key it reads. */
  readonly source: string;
  readonly lines: readonly HookLine[];
  /** The text for a repository git reads no hooks folder of; without it, such a repository is passed over. */
  readonly unreadable?: (main: string) => string;
  /** The text for a repository whose scripts in `scripts` lack the lines given, which `adds` names with their hooks. */
  readonly missing: (scripts: string, missing: readonly HookLine[], adds: string) => string;
}

function warning(check: HookLineCheck, name: string, text: string): UnownedWarning {
  return { key: `${check.flag.toLowerCase()} ${name}`, source: check.source, text: `${check.flag} ${name} ${text}` };
}

/** The repository's warning: the hook lines its scripts lack and where to add each; none when they hold them all. */
async function repoWarning(files: Files, git: Pick<SecretsGit, 'hooksDir'>, check: HookLineCheck, name: string, main: string): Promise<UnownedWarning | undefined> {
  const hooksDir = git.hooksDir(main);
  if (hooksDir === undefined) {
    return check.unreadable === undefined ? undefined : warning(check, name, check.unreadable(main));
  }
  const scripts = hookScriptsDir(hooksDir);
  const missing = await missingHookLines(files, scripts, check.lines);
  if (missing.length === 0) {
    return undefined;
  }
  const adds = missing.map((hook) => `\`${hook.line}\` to ${hook.hook}`).join(', ');
  return warning(check, name, check.missing(scripts, missing, adds));
}

/** The check's warning for each repository in `delivery.repos`, in their order: one git call, then a read of its scripts. */
export async function hookLineWarnings(files: Files, git: Pick<SecretsGit, 'hooksDir'>, paths: Pick<TeamPaths, 'home'>, repos: DeliveryConfig['repos'], check: HookLineCheck): Promise<UnownedWarning[]> {
  const warnings: UnownedWarning[] = [];
  for (const [name, repo] of Object.entries(repos)) {
    const found = await repoWarning(files, git, check, name, teamPlace(paths, repo.mainCheckout));
    if (found !== undefined) {
      warnings.push(found);
    }
  }
  return warnings;
}
