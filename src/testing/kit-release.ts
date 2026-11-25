import { join } from 'node:path';
import { CLIENT_MANIFEST, clientFileHash, clientManifestText } from '../exec/client-integrity.ts';
import type { MemoryFiles } from './memory-files.ts';

/** The text of a fake release's `dist/cli/main.js`, which names its version so a spec can tell copies apart. */
export function kitReleaseMain(version: string): string {
  return `export const v = '${version}';\n`;
}

/**
 * A built plugin folder of `version` at `root`, as the build leaves it: its client files, plugin.json, a skill and the
 * integrity list over the client files. `main` gives another build of the same version.
 */
export async function writeKitRelease(files: MemoryFiles, root: string, version: string, main: string = kitReleaseMain(version)): Promise<void> {
  const client = { 'bin/teamrig': '#!/bin/sh\n', 'dist/cli/main.js': main,'hooks/hooks.json': '{}\n', 'package.json': '{"type":"module"}\n' };
  for (const [path, text] of Object.entries(client)) {
    await files.write(join(root, path), text);
  }
  await files.write(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'teamrig', version }));
  await files.write(join(root, 'skills', 'guide', 'SKILL.md'), '# guide\n');
  const list = new Map(Object.entries(client).map(([path, text]) => [path, clientFileHash(text)]));
  await files.write(join(root, CLIENT_MANIFEST), clientManifestText(list));
}
