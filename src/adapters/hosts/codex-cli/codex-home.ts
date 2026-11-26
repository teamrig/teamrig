import { posix, win32 } from 'node:path';
import type { HostDeps } from '../../../plugin-api/index.ts';

/** Moves Codex's own folder (config, hooks, skills, login) away from `~/.codex`. */
const HOME_VAR = 'CODEX_HOME';
const DEFAULT_HOME = '.codex';

/**
 * Codex's own folder for the person whose home folder is `userHome`: the folder `CODEX_HOME` names, else
 * `~/.codex`. A blank `CODEX_HOME` counts as unset, as Codex reads it.
 */
export function codexHomeOf(env: HostDeps['env'], platform: HostDeps['platform']): (userHome: string) => string {
  const path = platform === 'win32' ? win32 : posix;
  return (userHome) => {
    const moved = env[HOME_VAR]?.trim();
    return moved ? moved : path.join(userHome, DEFAULT_HOME);
  };
}
