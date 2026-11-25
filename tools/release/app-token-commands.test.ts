import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { TempRepo } from '../lib/temp-repo.ts';
import { mintCommand, revokeCommand } from './app-token-commands.ts';
import type { AppKey, Fetch, GitHubApi, MergeDeps } from './release-merge.ts';

const noFetch: Fetch = async () => {
  throw new Error('the command itself never calls GitHub');
};

interface MintCall {
  readonly repo: string;
  readonly key: AppKey;
  readonly now: number;
}

describe('mintCommand', () => {
  let repo: TempRepo;
  let output: string;
  let printed: string[];
  let calls: MintCall[];

  beforeEach(() => {
    repo = new TempRepo('app-token').init();
    output = join(repo.outside, 'output');
    writeFileSync(output, '');
    printed = [];
    calls = [];
  });

  afterEach(() => repo.remove());

  const env = (over: Readonly<Record<string, string | undefined>> = {}) => ({
    GITHUB_REPOSITORY: 'acme/tool',
    GITHUB_OUTPUT: output,
    APP_ID: '42',
    APP_KEY: 'the-key',
    ...over,
  });

  const mint = async (repoName: string, key: AppKey, deps: MergeDeps): Promise<string> => {
    calls.push({ repo: repoName, key, now: deps.nowSeconds() });
    return 'ghs_minted';
  };

  const run = (over: Readonly<Record<string, string | undefined>> = {}) =>
    mintCommand(env(over), { mint, fetchFn: noFetch, nowSeconds: () => 1_000, out: (line) => printed.push(line) });

  it('mints for this repository with the App key, masks the token before anything else, and writes it as the step output', async () => {
    assert.equal(await run(), 0);
    assert.deepEqual(calls, [{ repo: 'acme/tool', key: { appId: 42, privateKey: 'the-key' }, now: 1_000 }]);
    assert.equal(printed[0], '::add-mask::ghs_minted');
    assert.ok(printed.slice(1).every((line) => !line.includes('ghs_minted')));
    assert.equal(readFileSync(output, 'utf8'), 'token=ghs_minted\n');
  });

  it('throws on a missing or malformed value before the key is used', async () => {
    await assert.rejects(run({ APP_KEY: undefined }), /APP_KEY is not set/);
    await assert.rejects(run({ APP_ID: '42; echo' }), /APP_ID is not in the form/);
    await assert.rejects(run({ GITHUB_OUTPUT: '' }), /GITHUB_OUTPUT is not set/);
    assert.deepEqual(calls, []);
    assert.equal(readFileSync(output, 'utf8'), '');
  });

  it('passes a mint GitHub refuses on as a throw, writing no output', async () => {
    const refused = mintCommand(env(), {
      mint: async () => {
        throw new Error('GitHub answered POST /app/installations/9/access_tokens with 403');
      },
      fetchFn: noFetch,
      nowSeconds: () => 1_000,
      out: (line) => printed.push(line),
    });
    await assert.rejects(refused, /with 403/);
    assert.deepEqual(printed, []);
    assert.equal(readFileSync(output, 'utf8'), '');
  });
});

describe('revokeCommand', () => {
  const revokeWith = async (answer: boolean, env: Readonly<Record<string, string | undefined>>) => {
    const tokens: string[] = [];
    const printed: string[] = [];
    const revoke = async (_api: GitHubApi, token: string): Promise<boolean> => {
      tokens.push(token);
      return answer;
    };
    const code = await revokeCommand(env, { revoke, fetchFn: noFetch, out: (line) => printed.push(line) });
    return { code, tokens, printed };
  };

  it('revokes the token it is handed', async () => {
    assert.deepEqual(await revokeWith(true, { TOKEN: 'ghs_minted' }), { code: 0, tokens: ['ghs_minted'], printed: ['the teamrig-release token was revoked'] });
  });

  it('only warns when GitHub refuses, as the token lapses within the hour', async () => {
    const { code, printed } = await revokeWith(false, { TOKEN: 'ghs_minted' });
    assert.equal(code, 0);
    assert.deepEqual(printed, ['::warning::the teamrig-release token could not be revoked: it expires within the hour']);
  });

  it('throws when no token is set', async () => {
    await assert.rejects(revokeWith(true, {}), /TOKEN is not set/);
  });
});
