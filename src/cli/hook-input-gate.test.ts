import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HostSource } from '../composition/host-ports.ts';
import type { HookBridge } from '../ports/host/index.ts';
import { APP, CLAUDE_SESSION, CliHarness } from '../testing/cli-harness.ts';
import { SHIPPED_HOST, testHooks } from '../testing/host.ts';
import { EXIT } from './runtime.ts';

const REASON = 'the PreToolUse hook input holds no toolCall';

interface Noted {
  readonly host: HostSource;
  /** Each input the bridge's `unreadable` was asked about. */
  readonly checked: string[];
  /** Each input the bridge's `parse` read. */
  readonly parsed: string[];
}

/** The shipped host, its hook bridge naming `reason` for every input it is asked to check, and noting what it reads. */
function hostNaming(reason: string | undefined): Noted {
  const checked: string[] = [];
  const parsed: string[] = [];
  const shipped = testHooks();
  const hooks: HookBridge = {
    parse: (raw, hostEvent) => {
      parsed.push(raw);
      return shipped.parse(raw, hostEvent);
    },
    unreadable: (raw) => {
      checked.push(raw);
      return reason;
    },
    reply: (on, reply) => shipped.reply(on, reply),
    titleSwitch: shipped.titleSwitch,
  };
  return { host: (given) => ({ ...SHIPPED_HOST(given), hooks }), checked, parsed };
}

const SHELL = JSON.stringify({
  hook_event_name: 'PreToolUse',
  cwd: APP,
  session_id: CLAUDE_SESSION,
  tool_name: 'Bash',
  tool_input: { command: 'git status' },
});

describe('runCli: a guard hook refuses an input its host named the event of but cannot read (T5574)', () => {
  it("refuses the call with the bridge's reason, naming the guard, before the guard runs", async () => {
    const { host, parsed } = hostNaming(REASON);
    const result = await new CliHarness().run(['hook', 'push-guard', '--host-event', 'PreToolUse'], { stdin: SHELL, host });
    assert.equal(result.code, EXIT.ok);
    const out = result.stdout.join('\n');
    assert.match(out, /deny/u);
    assert.match(out, /push-guard refused this call: the PreToolUse hook input holds no toolCall, so it cannot check it/u);
    assert.deepEqual(parsed, [], 'the guard never ran');
  });

  it('runs the guard on the same input when the bridge reads it', async () => {
    const { host, checked, parsed } = hostNaming(undefined);
    const result = await new CliHarness().run(['hook', 'secret-guard', '--host-event', 'PreToolUse'], { stdin: SHELL, host });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(checked, [SHELL]);
    assert.ok(parsed.length > 0 && parsed.every((raw) => raw === SHELL), 'the guard read the input the gate read');
    assert.doesNotMatch(result.stdout.join('\n'), /refused this call/u);
  });

  it('leaves a hook that guards nothing to its own reading', async () => {
    const { host, checked } = hostNaming(REASON);
    const prompt = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: APP, session_id: CLAUDE_SESSION, prompt: 'hello' });
    const result = await new CliHarness().run(['hook', 'inbox-reminder', '--host-event', 'PreInvocation'], { stdin: prompt, host });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(checked, []);
  });

  it('checks nothing on a line that names no event, as on a host whose input names its own', async () => {
    const { host, checked } = hostNaming(REASON);
    const result = await new CliHarness().run(['hook', 'push-guard'], { stdin: SHELL, host });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(checked, []);
    assert.doesNotMatch(result.stdout.join('\n'), /refused this call/u);
  });
});
