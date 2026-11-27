import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replyText } from '../testing/host.ts';
import { quietWorld } from '../testing/quiet-world.ts';
import { GUARD_HOOKS } from './guard-runner.ts';
import { UnlistedHostError } from './host-choice.ts';
import { EXIT, type CliRuntime } from './runtime.ts';
import { answerUnlistedHost, unlistedHostNotice } from './unlisted-host-hook.ts';

interface HookRun {
  readonly runtime: Pick<CliRuntime, 'readStdin' | 'out' | 'env' | 'platform' | 'hostEvent'>;
  readonly error: UnlistedHostError;
  /** What the hook printed, a line per entry. */
  readonly stdout: readonly string[];
}

const SESSION = '0a1b2c3d-0000-4000-8000-0123456789ab';
const SESSION_START = JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION, source: 'startup' });

/** A hook run in the quiet world for `codex-cli`, a host the team's `hosts` (claude-code) does not list. */
function unlistedRun(stdin: string = SESSION_START): HookRun {
  const world = quietWorld('dev', stdin);
  const stdout: string[] = [];
  const out = { stdout: (line: string): void => void stdout.push(line), stderr: (): void => undefined };
  const error = new UnlistedHostError('codex-cli', ['claude-code'], world.host);
  return { runtime: { readStdin: world.readStdin, out, env: {}, platform: world.platform }, error, stdout };
}

describe('unlistedHostNotice', () => {
  it('names the listed hosts, the missing host and the line that turns the hooks back on', () => {
    const notice = unlistedHostNotice({ hostId: 'codex-cli', listed: ['claude-code', 'cursor'] });
    assert.match(notice, /this team's hosts \(claude-code, cursor\) does not list codex-cli/);
    assert.match(notice, /Add "codex-cli" to hosts in the team config, then start a new session\.$/);
  });
});

describe('answerUnlistedHost (T5735)', () => {
  it("greets the session once, in the host's own reply, with the notice for the person and the model", async () => {
    const run = unlistedRun();
    assert.equal(await answerUnlistedHost('hook session-start', run.error, run.runtime), EXIT.ok);
    const notice = unlistedHostNotice(run.error);
    assert.deepEqual(run.stdout, [replyText('session-start', { notice, context: notice })]);
  });

  it('writes nothing at the session start when the input is no session start', async () => {
    const run = unlistedRun('not json');
    assert.equal(await answerUnlistedHost('hook session-start', run.error, run.runtime), EXIT.ok);
    assert.deepEqual(run.stdout, []);
  });

  it('ends every other hook that is no guard cleanly with nothing written', async () => {
    for (const hook of ['hook stop', 'hook inbox-reminder', 'hook route-reminder']) {
      const run = unlistedRun();
      assert.equal(await answerUnlistedHost(hook, run.error, run.runtime), EXIT.ok, hook);
      assert.deepEqual(run.stdout, [], hook);
    }
  });

  it('leaves every guard to its refusal, so a call is never let through', async () => {
    assert.ok(GUARD_HOOKS.size > 0);
    for (const guard of GUARD_HOOKS) {
      const run = unlistedRun();
      assert.equal(await answerUnlistedHost(`hook ${guard}`, run.error, run.runtime), undefined, guard);
      assert.deepEqual(run.stdout, [], guard);
    }
  });

  it('leaves a command that is no hook to its refusal', async () => {
    for (const command of ['config validate', 'hook']) {
      const run = unlistedRun();
      assert.equal(await answerUnlistedHost(command, run.error, run.runtime), undefined, command);
    }
  });
});
