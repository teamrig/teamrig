import { posix, win32 } from 'node:path';
import type { HostDeps, HostPaths } from '../../../plugin-api/index.ts';

/**
 * Antigravity's verified folders and files on `platform`. An unverified place answers undefined rather than a guess
 * teamrig might write to or guard, and each caller goes on without it.
 */
export function hostPaths(platform: HostDeps['platform']): HostPaths {
  const path = platform === 'win32' ? win32 : posix;
  const home = (userHome: string): string => path.join(userHome, '.gemini', 'config');

  return {
    home,
    userSettings: (userHome) => path.join(userHome, '.gemini', 'antigravity-cli', 'settings.json'),
    folderSettings: () => [],
    worktrees: () => undefined,
    worktreeRepo: () => undefined,
    userInstructions: (userHome) => path.join(userHome, '.gemini', 'GEMINI.md'),
    folderInstructions: (folder) => [path.join(folder, 'AGENTS.md'), path.join(folder, 'GEMINI.md')],
    userRules: (userHome) => path.join(home(userHome), 'rules'),
    projectRules: (project) => path.join(project, '.agents', 'rules'),
    skills: (userHome) => path.join(home(userHome), 'skills'),
    projectSkills: (project) => path.join(project, '.agents', 'skills'),
    userAgents: () => undefined,
    projectAgents: (project) => path.join(project, '.agents', 'agents'),
    memoryFolder: () => undefined,
    memoryIndex: () => undefined,
    memoryFolders: () => undefined,
    scratchpads: () => undefined,
    scratchpadOf: () => undefined,
    planFile: () => undefined,
    shellSnapshots: () => undefined,
    transcriptsFolder: () => undefined,
    pluginsFolder: () => undefined,
    loginFile: () => undefined,
  };
}
