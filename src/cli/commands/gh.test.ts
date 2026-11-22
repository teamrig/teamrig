import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { GhRequest, GhResult, GhRunner } from '../../adapters/connectors/github/gh.ts';
import { CliHarness, KIT } from '../../testing/cli-harness.ts';
import { FakeCredentials, ownerToken, TEST_OWNERS } from '../../testing/fake-credentials.ts';
import { FakePathProbe } from '../../testing/fake-processes.ts';
import { ghConfigDirOf } from '../gh-child.ts';
import { EXIT } from '../runtime.ts';

/** A gh that answers every call with one result and keeps each request. */
class OneAnswerGh implements GhRunner {
  readonly ran: GhRequest[] = [];
  private readonly answer: GhResult;

  constructor(answer: GhResult) {
    this.answer = answer;
  }

  run(request: GhRequest): Promise<GhResult> {
    this.ran.push(request);
    return Promise.resolve(this.answer);
  }
}

const VIEW = ['gh', '--', 'issue', 'view', '12', '-R', 'acme/app'];

/** A PATH where the installed gh and git are found, as `teamrig gh` looks them up. */
const INSTALLED = { env: { PATH: '/usr/bin' }, probe: new FakePathProbe({ files: ['/usr/bin/gh', '/usr/bin/git'] }) } as const;

describe('teamrig gh', () => {
  it('refuses a line naming no gh command, reading no key', async () => {
    const credentials = new FakeCredentials();
    const result = await new CliHarness().run(['gh', '--'], { credentials });
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.join('\n'), /^REFUSED teamrig gh: it names no gh command/);
    assert.deepEqual(credentials.reads, []);
  });

  it('refuses a call whose owner has no saved key, naming the command that saves one, and never falls back to the login', async () => {
    const result = await new CliHarness().run(VIEW, { ...INSTALLED, credentials: new FakeCredentials() });
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.join('\n'), /^REFUSED teamrig gh: no token for acme is saved as .+ save one with: /);
  });

  it("runs gh in the team's folder on the owner's saved key and exits 0 when gh did", async () => {
    const gh = new OneAnswerGh({ end: { kind: 'exited', code: 0 }, stdout: '{"state":"OPEN"}\n', stderr: '' });
    const result = await new CliHarness().run(VIEW, { gh, ...INSTALLED, credentials: new FakeCredentials().savesTokensFor(TEST_OWNERS) });
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.deepEqual(gh.ran.map((request) => [request.args, request.env['GH_TOKEN']]), [[VIEW.slice(2), ownerToken('acme')]]);
  });

  it('exits 1 when gh fails, outside any team too', async () => {
    const gh = new OneAnswerGh({ end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'no such issue\n' });
    const result = await new CliHarness().run(VIEW, { gh, ...INSTALLED, cwd: '/elsewhere', credentials: new FakeCredentials().savesTokensFor(TEST_OWNERS) });
    assert.equal(result.code, EXIT.failed);
    assert.equal(gh.ran.length, 1);
  });

  it('gives gh none of the browser, editor, pager or config variables the session set, nor its tokens (T4961)', async () => {
    const gh = new OneAnswerGh({ end: { kind: 'exited', code: 0 }, stdout: '', stderr: '' });
    const session = { GH_BROWSER: 'evil', BROWSER: 'evil', GH_EDITOR: 'evil', EDITOR: 'evil', VISUAL: 'evil', GH_PAGER: 'evil', PAGER: 'evil', GH_CONFIG_DIR: '/s', XDG_CONFIG_HOME: '/s', UNLISTED: 'x', GITHUB_TOKEN: 'held' };
    const result = await new CliHarness().run(VIEW, { gh, ...INSTALLED, env: { ...INSTALLED.env, ...session }, credentials: new FakeCredentials().savesTokensFor(TEST_OWNERS) });
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    const env = gh.ran[0]?.env ?? {};
    for (const [name, value] of Object.entries(session)) {
      assert.notEqual(env[name], value, name);
    }
    assert.equal(env['GH_CONFIG_DIR'], ghConfigDirOf(KIT, 'linux'));
    assert.equal(env['GH_BROWSER'], '"/usr/bin/node" --eval=process.exit(1)');
    assert.equal(env['GH_TOKEN'], ownerToken('acme'));
  });

  it('refuses when PATH has no gh, reading no key (T4961)', async () => {
    const credentials = new FakeCredentials().savesTokensFor(TEST_OWNERS);
    const result = await new CliHarness().run(VIEW, { credentials });
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.join('\n'), /^REFUSED teamrig gh: gh is not on PATH/u);
    assert.deepEqual(credentials.reads, []);
  });
});
