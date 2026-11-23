import { runMain } from '../lib/run-main.ts';
import { readChannels } from './channels.ts';
import { pullUpdateCommand } from './pull-update.ts';

/**
 * Run by .github/workflows/release.yml before release-please (T5186): says whether this run opens or updates the
 * release pull request (pull-update.ts), wired to this process's environment and the clock. Takes no arguments; a
 * missing value exits 2.
 */

function main(): Promise<number> {
  if (process.argv.length > 2) throw new Error('takes no arguments');
  return Promise.resolve(pullUpdateCommand(process.env, { channels: readChannels(), now: new Date(), out: console.log }));
}

process.exitCode = await runMain('pull-update', main, console.error);
