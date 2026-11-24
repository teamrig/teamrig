import { runMain } from '../lib/run-main.ts';
import { readProfiles } from '../ship/repos.ts';
import { readChannels } from './channels.ts';
import { pullUpdateCommand } from './pull-update.ts';

/**
 * Run by .github/workflows/release.yml before release-please (T5186): says whether this run opens or updates the
 * release pull request (pull-update.ts), wired to this process's environment, GitHub and the clock. Takes no
 * arguments; a missing value exits 2.
 */

async function main(): Promise<number> {
  if (process.argv.length > 2) throw new Error('takes no arguments');
  return pullUpdateCommand(process.env, { profiles: readProfiles(), fetchFn: fetch, channels: readChannels(), now: new Date(), out: console.log });
}

process.exitCode = await runMain('pull-update', main, console.error);
