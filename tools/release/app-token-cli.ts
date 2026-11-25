import { runMain } from '../lib/run-main.ts';
import { mintCommand, revokeCommand } from './app-token-commands.ts';
import { epochSeconds } from './release-merge-commands.ts';
import { mintAppToken, revokeAppToken } from './release-merge.ts';

/**
 * Run by .github/workflows/release.yml (T5390): `mint` or `revoke` the teamrig-release App token the release pull
 * request is written with (app-token-commands.ts), wired to this process's environment, GitHub and its output.
 * A missing or malformed value exits 2.
 */

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (rest.length > 0) throw new Error('takes one argument: mint or revoke');
  if (command === 'mint') return mintCommand(process.env, { mint: mintAppToken, fetchFn: fetch, nowSeconds: epochSeconds, out: console.log });
  if (command === 'revoke') return revokeCommand(process.env, { revoke: revokeAppToken, fetchFn: fetch, out: console.log });
  throw new Error('takes one argument: mint or revoke');
}

// console's methods are bound to it, so they pass as plain functions; the CLI keeps no function of its own but main.
process.exitCode = await runMain('app-token', main, console.error);
