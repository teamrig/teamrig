import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeCredentials } from '../../testing/fake-credentials.ts';
import { UsageError, type ParsedArgs } from '../args.ts';
import { gitCredential } from './git-credential.ts';

interface HelperRun {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly reads: string[];
  readonly exit: number;
}

function argsOf(positionals: readonly string[], common: ReadonlyMap<string, string>): ParsedArgs {
  return { command: 'git-credential', positionals, flags: new Map(), switches: new Set(), rest: [], help: false, common };
}

async function helperRun(
  positionals: readonly string[],
  stdin: string,
  store: FakeCredentials = new FakeCredentials().saves('teamrig-gh-acme', 'acme-key'),
  common: ReadonlyMap<string, string> = new Map(),
): Promise<HelperRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = { stdout: (line: string): void => void stdout.push(line), stderr: (line: string): void => void stderr.push(line) };
  const exit = await gitCredential(argsOf(positionals, common), { readStdin: async () => stdin, out, credentials: store });
  return { stdout, stderr, reads: store.reads, exit };
}

const GET = 'protocol=https\nhost=github.com\npath=acme/app.git\n\n';

describe('teamrig git-credential', () => {
  it("answers get with the owner's saved key, one protocol line at a time, and says nothing on stderr", async () => {
    const run = await helperRun(['get'], GET);
    assert.equal(run.exit, 0);
    assert.deepEqual(run.stdout, ['username=x-access-token', 'password=acme-key']);
    assert.deepEqual(run.stderr, []);
  });

  it('answers quit, with the reason on stderr, for an owner with no saved key', async () => {
    const run = await helperRun(['get'], 'protocol=https\nhost=github.com\npath=globex/api\n\n');
    assert.equal(run.exit, 0);
    assert.deepEqual(run.stdout, ['quit=1']);
    assert.match(run.stderr.join('\n'), /^teamrig git-credential: no key given: /u);
  });

  it('answers quit, reading no key, for a request git never writes', async () => {
    for (const stdin of ['protocol=https\r\nhost=github.com\n', 'protocol=https\nhost=github.com\nhost=evil.example\npath=acme/app\n', 'injected=1\n']) {
      const run = await helperRun(['get'], stdin);
      assert.deepEqual(run.stdout, ['quit=1'], stdin);
      assert.deepEqual(run.reads, [], stdin);
      assert.match(run.stderr.join('\n'), /no key given/u, stdin);
    }
  });

  it('keeps nothing on store and erase: no output, no store read, exit 0', async () => {
    for (const operation of ['store', 'erase']) {
      const run = await helperRun([operation], `${GET.trimEnd()}\nusername=x-access-token\npassword=other\n\n`);
      assert.equal(run.exit, 0, operation);
      assert.deepEqual([run.stdout, run.stderr, run.reads], [[], [], []], operation);
    }
  });

  it('refuses any other operation, or more than one word, as a usage error', async () => {
    for (const positionals of [[], ['list'], ['get', 'more']]) {
      await assert.rejects(helperRun(positionals, GET), UsageError, positionals.join(' '));
    }
  });

  it('refuses --session or --team as a usage error, reading no key, since git passes no flag', async () => {
    for (const flag of ['session', 'team']) {
      const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-key');
      await assert.rejects(helperRun(['get'], GET, store, new Map([[flag, 'x']])), UsageError, flag);
      assert.deepEqual(store.reads, [], flag);
    }
  });
});
