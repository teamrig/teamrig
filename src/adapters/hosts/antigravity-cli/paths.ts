import { posix, win32 } from 'node:path';
import type { HostDeps, HostPaths } from '../../../plugin-api/index.ts';

function unsupportedPath(what: string): never {
  throw new Error(`unsupported: Antigravity has no verified ${what} path`);
}

/**
 * Antigravity's verified folders and files on `platform`. Unverified paths throw rather than guessing a path teamrig
 * might write to or guard.
 */
export function hostPaths(platform: HostDeps['platform']): HostPaths {
  const path = platform === 'win32' ? win32 : posix;
  const home = (userHome: string): string => path.join(userHome, '.gemini', 'config');

  return {
    home,
    userSettings: (userHome) => path.join(userHome, '.gemini', 'antigravity-cli', 'settings.json'),
    folderSettings: () => [],
    worktrees: () => unsupportedPath('worktrees'),
    worktreeRepo: () => undefined,
    userInstructions: (userHome) => path.join(userHome, '.gemini', 'GEMINI.md'),
    folderInstructions: (folder) => [path.join(folder, 'AGENTS.md'), path.join(folder, 'GEMINI.md')],
    userRules: (userHome) => path.join(home(userHome), 'rules'),
    projectRules: (project) => path.join(project, '.agents', 'rules'),
    skills: (userHome) => path.join(home(userHome), 'skills'),
    projectSkills: (project) => path.join(project, '.agents', 'skills'),
    userAgents: () => unsupportedPath('userAgents'),
    projectAgents: (project) => path.join(project, '.agents', 'agents'),
    memoryFolder: () => unsupportedPath('memoryFolder'),
    memoryIndex: () => unsupportedPath('memoryIndex'),
    memoryFolders: () => unsupportedPath('memoryFolders'),
    scratchpads: () => unsupportedPath('scratchpads'),
    scratchpadOf: () => unsupportedPath('scratchpadOf'),
    planFile: () => unsupportedPath('planFile'),
    shellSnapshots: () => unsupportedPath('shellSnapshots'),
    secretFiles: () => [],
  };
}
