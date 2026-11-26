import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bash, CliHarness, decisionOf, reasonOf, type CliResult } from '../../testing/cli-harness.ts';
import { SET_GUARDS } from '../guard-runner.ts';
import { EXIT } from '../runtime.ts';
import { SET_GUARD_REPLIES } from './hook-guard-set.ts';

/** Every guard the plugin runs on a shell call, in the order hooks.json names them. */
const SHELL_SET = ['push-guard', 'package-guard', 'secret-guard', 'db-write-guard', 'exec-guard', 'pass-record-guard', 'install-guard', 'service-role-guard'];
/** A tab bound to alpha, as the exec guard reads it. */
const ALPHA = { TEAMRIG_SESSION: 'alpha' };

function set(kit: CliHarness, guards: readonly string[], command: string): Promise<CliResult> {
  return kit.run(['hook', 'guards', ...guards], { stdin: bash(command), env: ALPHA });
}

function alone(kit: CliHarness, guard: string, command: string): Promise<CliResult> {
  return kit.run(['hook', guard], { stdin: bash(command), env: ALPHA });
}

describe('hook guards (T5553)', () => {
  it('names the same guards as the runner lets run in a set, which may import neither', () => {
    assert.deepEqual([...SET_GUARD_REPLIES.keys()].sort(), [...SET_GUARDS].sort());
  });

  it('refuses a call one guard of the set refuses, with the reason that guard gives alone', async () => {
    const kit = new CliHarness();
    const push = 'git push origin main';
    const result = await set(kit, SHELL_SET, push);
    assert.equal(result.code, EXIT.ok);
    assert.equal(decisionOf(result), 'deny');
    assert.equal(reasonOf(result), reasonOf(await alone(kit, 'push-guard', push)));
  });

  it("refuses with every refusing guard's reason, in the set's order, on a call two guards refuse", async () => {
    const kit = new CliHarness();
    const line = 'git push origin main; env -u CLAUDECODE teamrig list';
    const push = reasonOf(await alone(kit, 'push-guard', line));
    const exec = reasonOf(await alone(kit, 'exec-guard', line));
    assert.ok(push !== undefined && exec !== undefined, 'each guard refuses the line alone');
    assert.equal(reasonOf(await set(kit, SHELL_SET, line)), `${push}\n${exec}`);
    assert.equal(reasonOf(await set(kit, ['exec-guard', 'push-guard'], line)), `${exec}\n${push}`);
  });

  it('prints nothing for a call no guard has a word about, nor for input that is no hook payload', async () => {
    const kit = new CliHarness();
    assert.deepEqual(await set(kit, SHELL_SET, 'ls'), { code: EXIT.ok, stdout: [], stderr: [] });
    assert.deepEqual(await kit.run(['hook', 'guards', ...SHELL_SET], { stdin: 'not json' }), { code: EXIT.ok, stdout: [], stderr: [] });
  });

  it('refuses a set naming no guard, a guard twice, or a guard that runs only alone, as a usage error', async () => {
    const kit = new CliHarness();
    for (const guards of [[], ['push-guard', 'push-guard'], ['push-guard', 'cold-send']]) {
      const result = await kit.run(['hook', 'guards', ...guards], { stdin: bash('ls') });
      assert.equal(result.code, EXIT.usage, guards.join(' '));
      assert.deepEqual(result.stdout, [], guards.join(' '));
    }
  });
});
