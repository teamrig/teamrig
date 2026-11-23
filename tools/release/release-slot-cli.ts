import { runMain } from '../lib/run-main.ts';
import { readProfiles } from '../ship/repos.ts';
import { readChannels } from './channels.ts';
import { slotCommand } from './release-slot.ts';

/**
 * Run hourly by .github/workflows/release-slot.yml in a checkout of main (T5133): says whether to run ci on the
 * release branch now (release-slot.ts), wired to this process's environment, GitHub and its output. Takes no
 * arguments; a missing or malformed value exits 2.
 */

async function main(): Promise<number> {
  if (process.argv.length > 2) throw new Error('takes no arguments');
  return slotCommand(process.env, { profiles: readProfiles(), fetchFn: fetch, channels: readChannels(), now: new Date(), out: console.log });
}

process.exitCode = await runMain('release-slot', main, console.error);
