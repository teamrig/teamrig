import { appendFileSync } from 'node:fs';
import { EXIT_CLEAN } from '../lib/exit.ts';
import { fetchGitHubApi, type AppKey, type Fetch, type GitHubApi, type MergeDeps } from './release-merge.ts';
import { envValue, type Env } from './release-merge-commands.ts';

/**
 * The teamrig-release App token release.yml opens and updates the release pull request with (T5390), run by
 * app-token-cli.ts, every value read from the environment and every effect passed in. A pull request the job's own
 * token writes has its pull_request runs held for a person's approval, so the required check never reports on it;
 * one the App writes runs like a member's.
 * - `mintCommand`: masks a token of the App for this repository alone (contents and pull requests write, an hour at
 *   most) in the job's log, then writes it to GITHUB_OUTPUT as `token`.
 * - `revokeCommand`: ends that token at once; a refusal is only a warning, as the token lapses within the hour anyway.
 * A missing or malformed value throws, which the CLI exits 2 on, before the key is used.
 */

const DIGITS = /^\d+$/;

export interface MintCommandDeps {
  readonly mint: (repo: string, key: AppKey, deps: MergeDeps) => Promise<string>;
  readonly fetchFn: Fetch;
  readonly nowSeconds: () => number;
  readonly out: (line: string) => void;
}

export interface RevokeCommandDeps {
  readonly revoke: (api: GitHubApi, token: string) => Promise<boolean>;
  readonly fetchFn: Fetch;
  readonly out: (line: string) => void;
}

const apiRoot = (env: Env): string | undefined => env['GITHUB_API_URL'] || undefined;

export async function mintCommand(env: Env, deps: MintCommandDeps): Promise<number> {
  const repo = envValue(env, 'GITHUB_REPOSITORY');
  const output = envValue(env, 'GITHUB_OUTPUT');
  const key: AppKey = { appId: Number(envValue(env, 'APP_ID', DIGITS)), privateKey: envValue(env, 'APP_KEY') };
  const token = await deps.mint(repo, key, { api: fetchGitHubApi(deps.fetchFn, apiRoot(env)), nowSeconds: deps.nowSeconds });
  // The mask goes first: from this line on the runner hides the token wherever a later step would print it.
  deps.out(`::add-mask::${token}`);
  appendFileSync(output, `token=${token}\n`);
  deps.out(`minted a teamrig-release token for ${repo}: contents and pull requests write, an hour at most`);
  return EXIT_CLEAN;
}

export async function revokeCommand(env: Env, deps: RevokeCommandDeps): Promise<number> {
  const token = envValue(env, 'TOKEN');
  const revoked = await deps.revoke(fetchGitHubApi(deps.fetchFn, apiRoot(env)), token);
  deps.out(revoked ? 'the teamrig-release token was revoked' : '::warning::the teamrig-release token could not be revoked: it expires within the hour');
  return EXIT_CLEAN;
}
