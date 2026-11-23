import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JsonRecord } from '../../core/guards.ts';
import { repoTokenName, tokenName } from '../../issues/token-names.ts';
import { CliHarness, TEAM } from '../../testing/cli-harness.ts';
import { FakeCredentials } from '../../testing/fake-credentials.ts';
import { FakeTerminal } from '../../testing/fake-terminal.ts';
import { EXIT } from '../runtime.ts';
import { scopesOf } from './key.ts';

const REPOS_TEAM: JsonRecord = { ...TEAM, github: { repos: ['acme/web', 'globex/api', 'acme/api'] } };
const WEB = repoTokenName('acme/web') ?? '';

/** A person at a terminal typing `key` into the store's save command, which saves it under the name it was given. */
function typing(store: FakeCredentials, key: string): FakeTerminal {
  return new FakeTerminal(true).answers((request) => {
    const [name] = request.args;
    if (name !== undefined) {
      store.saves(name, key);
    }
    return { kind: 'exited', code: 0 };
  });
}

describe('teamrig key list', () => {
  it("lists each owner's key and each repository's own, saved or not, and never prints a key", async () => {
    const store = new FakeCredentials().saves(tokenName('acme'), 'acme-secret').saves(WEB, 'web-secret').failsOn(tokenName('globex'), 'keyring locked');
    const run = await new CliHarness(REPOS_TEAM).run(['key', 'list'], { credentials: store });
    assert.equal(run.code, EXIT.ok);
    assert.deepEqual(run.stdout, [
      `acme  ${tokenName('acme')}  saved`,
      `acme/api  ${repoTokenName('acme/api') ?? ''}  missing: its owner's key reaches it`,
      `acme/web  ${WEB}  saved`,
      `globex  ${tokenName('globex')}  unreadable: keyring locked`,
      `globex/api  ${repoTokenName('globex/api') ?? ''}  missing: its owner's key reaches it`,
    ]);
    assert.doesNotMatch(run.stdout.join('\n'), /secret/u);
  });

  it('says how keys are named when the team lists no repository', async () => {
    const run = await new CliHarness(TEAM).run(['key', 'list'], { credentials: new FakeCredentials() });
    assert.equal(run.code, EXIT.ok);
    assert.match(run.stdout.join('\n'), /no repository in github\.repos.*teamrig key add <owner\|owner\/name>/u);
  });
});

describe('scopesOf', () => {
  it('gives each owner once, before its repositories, all in lowercase and sorted', () => {
    assert.deepEqual(
      scopesOf(['Acme/Web', 'acme/api']).map((scope) => scope.scope),
      ['acme', 'acme/api', 'acme/web'],
    );
  });
});

describe('teamrig key add', () => {
  it("runs the store's own save command in the person's terminal, then reads the key back", async () => {
    const store = new FakeCredentials();
    const terminal = typing(store, 'typed-key');
    const run = await new CliHarness(REPOS_TEAM).run(['key', 'add', 'Acme/Web'], { credentials: store, keys: { keeper: store, terminal } });
    assert.equal(run.code, EXIT.ok);
    assert.deepEqual(terminal.ran, [store.saveRequest(WEB)]);
    assert.match(run.stdout.join('\n'), /saving a key for acme\/web/u);
    assert.match(run.stdout.join('\n'), /saved: acme\/web now uses/u);
    assert.doesNotMatch([...run.stdout, ...run.stderr].join('\n'), /typed-key/u);
  });

  it('says it replaces a key saved under the name before', async () => {
    const store = new FakeCredentials().saves(tokenName('acme'), 'old-key');
    const run = await new CliHarness(TEAM).run(['key', 'add', 'acme'], { credentials: store, keys: { keeper: store, terminal: typing(store, 'new-key') } });
    assert.equal(run.code, EXIT.ok);
    assert.match(run.stdout.join('\n'), /replacing the key for acme/u);
  });

  it('refuses a run with no person at a terminal, running nothing', async () => {
    const store = new FakeCredentials();
    const terminal = new FakeTerminal(false);
    const run = await new CliHarness(TEAM).run(['key', 'add', 'acme'], { credentials: store, keys: { keeper: store, terminal } });
    assert.equal(run.code, EXIT.refused);
    assert.match([...run.stdout, ...run.stderr].join('\n'), /only from a person's own terminal/u);
    assert.deepEqual(terminal.ran, []);
  });

  it('refuses what is no GitHub owner or owner/name, running nothing', async () => {
    const store = new FakeCredentials();
    const terminal = new FakeTerminal(true);
    const run = await new CliHarness(TEAM).run(['key', 'add', 'acme/web/x'], { credentials: store, keys: { keeper: store, terminal } });
    assert.equal(run.code, EXIT.refused);
    assert.deepEqual(terminal.ran, []);
  });

  it('fails when the save command fails, or ends with nothing saved', async () => {
    const store = new FakeCredentials();
    const failing = new FakeTerminal(true).answers(() => ({ kind: 'exited', code: 1 }));
    const failed = await new CliHarness(TEAM).run(['key', 'add', 'acme'], { credentials: store, keys: { keeper: store, terminal: failing } });
    assert.equal(failed.code, EXIT.failed);
    assert.match(failed.stderr.join('\n'), /save command exited 1; nothing new is saved/u);
    const empty = await new CliHarness(TEAM).run(['key', 'add', 'acme'], { credentials: store, keys: { keeper: store, terminal: new FakeTerminal(true) } });
    assert.equal(empty.code, EXIT.failed);
    assert.match(empty.stderr.join('\n'), /is not there/u);
  });
});

describe('teamrig key remove', () => {
  it('removes the saved key and says to revoke it at GitHub', async () => {
    const store = new FakeCredentials().saves(WEB, 'web-key');
    const run = await new CliHarness(TEAM).run(['key', 'remove', 'acme/web'], { credentials: store, keys: { keeper: store, terminal: new FakeTerminal(true) } });
    assert.equal(run.code, EXIT.ok);
    assert.deepEqual(store.removes, [WEB]);
    assert.match(run.stdout.join('\n'), /revoke it at https:\/\/github\.com\//u);
  });

  it('removes nothing when nothing is saved, and fails on a failed remove', async () => {
    const empty = new FakeCredentials();
    const none = await new CliHarness(TEAM).run(['key', 'remove', 'acme'], { credentials: empty, keys: { keeper: empty, terminal: new FakeTerminal(true) } });
    assert.equal(none.code, EXIT.ok);
    assert.deepEqual(empty.removes, []);
    const stuck = new FakeCredentials().saves(tokenName('acme'), 'k').removeFailsOn(tokenName('acme'), 'access denied');
    const failed = await new CliHarness(TEAM).run(['key', 'remove', 'acme'], { credentials: stuck, keys: { keeper: stuck, terminal: new FakeTerminal(true) } });
    assert.equal(failed.code, EXIT.failed);
    assert.match(failed.stderr.join('\n'), /access denied/u);
  });

  it('refuses a run with no person at a terminal', async () => {
    const store = new FakeCredentials().saves(tokenName('acme'), 'k');
    const run = await new CliHarness(TEAM).run(['key', 'remove', 'acme'], { credentials: store, keys: { keeper: store, terminal: new FakeTerminal(false) } });
    assert.equal(run.code, EXIT.refused);
    assert.deepEqual(store.removes, []);
  });
});
