import { join } from 'node:path';
import { FIND_TEAMRIG_CLI } from '../core/launcher-script.ts';

/** The launcher's place under the kit home: `<kit home>/bin/statusline.mjs`. */
export function launcherPath(kitHome: string): string {
  return join(kitHome, 'bin', 'statusline.mjs');
}

/**
 * The launcher `teamrig statusline install` writes. Claude Code's settings name this file because it never
 * moves, while the version and plugin folders change with every version. On each run it finds teamrig's CLI
 * (FIND_TEAMRIG_CLI: the kit launcher, else Claude Code's plugin) and runs `teamrig statusline` (with `--pass` when
 * given) on the same input. It always exits 0, so a missing version or a failed run never breaks the status bar;
 * with `--pass` it then passes the input on itself, so the status line after it still runs. The text
 * carries no kit version: it changes only when its own logic does, so an update leaves it alone.
 */
export const LAUNCHER_SCRIPT = String.raw`// Written by "teamrig statusline install"; "teamrig statusline uninstall" removes it.
// Runs "teamrig statusline" (the kit launcher, else Claude Code's plugin) on Claude Code's status input.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pass = process.argv.includes('--pass');
let input = '';
try {
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
} catch {}

${FIND_TEAMRIG_CLI}

const main = teamrigCli();
const run = main === undefined
  ? undefined
  : spawnSync(process.execPath, [main, 'statusline', ...(pass ? ['--pass'] : [])], { input, encoding: 'utf8', windowsHide: true });
if (run?.stderr) process.stderr.write(run.stderr);
if (run !== undefined && run.status === 0) {
  process.stdout.write(run.stdout);
} else {
  const problem = main === undefined ? 'teamrig not found' : 'teamrig failed';
  process.stderr.write('teamrig statusline: ' + problem + '\n');
  process.stdout.write(pass ? input : problem + '\n');
}
`;
