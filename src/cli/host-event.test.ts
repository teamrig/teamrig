import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HostSource } from '../composition/host-ports.ts';
import type { HookBridge } from '../ports/host/index.ts';
import { APP, CLAUDE_SESSION, CliHarness } from '../testing/cli-harness.ts';
import { SHIPPED_HOST, testHooks } from '../testing/host.ts';
import { EXIT } from './runtime.ts';

/** The shipped host, its hook bridge noting the event each call's command line named before it reads the input. */
function eventNotingHost(): { readonly host: HostSource; readonly named: (string | undefined)[] } {
  const named: (string | undefined)[] = [];
  const shipped = testHooks();
  const hooks: HookBridge = {
    parse: (raw, hostEvent) => {
      named.push(hostEvent);
      return shipped.parse(raw, hostEvent);
    },
    reply: (on, reply) => shipped.reply(on, reply),
    failureRule: shipped.failureRule,
  };
  return { host: (given) => ({ ...SHIPPED_HOST(given), hooks }), named };
}

const PROMPT = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: APP, session_id: CLAUDE_SESSION, prompt: 'hello' });

describe('runCli: a hook takes the event its host named on the command line (T4752)', () => {
  it("hands --host-event to the host's hook bridge with the input", async () => {
    const { host, named } = eventNotingHost();
    const result = await new CliHarness().run(['hook', 'inbox-reminder', '--host-event', 'PreInvocation'], { stdin: PROMPT, host });
    assert.equal(result.code, EXIT.ok);
    assert.ok(named.length > 0, 'the hook read its input');
    assert.deepEqual([...new Set(named)], ['PreInvocation']);
  });

  it('hands no event when the line names none, as on a host whose input names its own', async () => {
    const { host, named } = eventNotingHost();
    const result = await new CliHarness().run(['hook', 'inbox-reminder'], { stdin: PROMPT, host });
    assert.equal(result.code, EXIT.ok);
    assert.ok(named.length > 0, 'the hook read its input');
    assert.deepEqual([...new Set(named)], [undefined]);
  });

  it('refuses --host-event on a command that is no hook', async () => {
    const result = await new CliHarness().run(['list', '--host-event', 'Stop']);
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr.join('\n'), /list takes no --host-event/u);
  });
});
