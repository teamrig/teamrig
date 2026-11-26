import type { posix } from 'node:path';
import { RefusedError } from './runtime.ts';

/** The plugin's entry script, below its root: `<root>/dist/cli/main.js`. */
const ENTRY_FOLDERS: readonly string[] = ['dist', 'cli'];
const ENTRY_SCRIPT = 'main.js';

/**
 * The installed plugin's root, from this CLI's entry script, for a `setup` command (`command`, as the person types it)
 * that points a host at the installed plugin's files. A run from the source tree, or any script but the plugin's
 * built entry, has no installed files to point the host at, so it is refused.
 */
export function pluginRootOf(script: string, path: typeof posix, command: string): string {
  const cli = path.dirname(script);
  const dist = path.dirname(cli);
  if (path.basename(script) !== ENTRY_SCRIPT || [path.basename(dist), path.basename(cli)].join('/') !== ENTRY_FOLDERS.join('/')) {
    throw new RefusedError(`${command} runs from the installed plugin's dist/cli/main.js, not ${script}, so the host runs the installed teamrig; nothing written`);
  }
  return path.dirname(dist);
}
