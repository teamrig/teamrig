import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonRecord } from '../../core/guards.ts';
import { failedGuardReason } from '../../hooks/guard-set.ts';
import { APP, bash, CliHarness, decisionOf, reasonOf, TEAM, type CliResult } from '../../testing/cli-harness.ts';
import type { ParsedArgs } from '../args.ts';
import { SET_GUARDS } from '../guard-runner.ts';
import { EXIT } from '../runtime.ts';
import { COMMAND_TABLE } from '../run.ts';
import { guardSetOf, setMembersOf, type SetMember } from './hook-guard-set.ts';

/** Every guard the plugin runs on a shell call, in the order hooks.json names them. */
const SHELL_SET = ['push-guard', 'package-guard', 'secret-guard', 'db-write-guard', 'exec-guard', 'pass-record-guard', 'install-guard', 'service-role-guard'];
/** A tab bound to alpha, as the exec guard reads it. */
const ALPHA = { TEAMRIG_SESSION: 'alpha' };
/** A team with the read-only shell allow on. */
const READONLY_TEAM: JsonRecord = { ...TEAM, readonlyShell: { enabled: true } };
/** A team whose hooks refuse a prompt, so route-allow lets a sanctioned route's line through. */
const ASKS_OFF: JsonRecord = { ...TEAM, prompts: { hookAsks: 'refuse' } };

/** `hook guards <names>` over the given members, on a Bash `ls` in the app folder. */
async function runSet(kit: CliHarness, members: ReadonlyMap<string, SetMember>, names: readonly string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = { stdout: (line: string) => stdout.push(line), stderr: (line: string) => stderr.push(line) };
  const args: ParsedArgs = { command: 'hook guards', positionals: names, flags: new Map(), switches: new Set(), rest: [], help: false, common: new Map() };
  const code = await guardSetOf(members)(args, kit.runtime({ stdin: bash('ls'), env: ALPHA }, out));
  return { code, stdout, stderr };
}

function set(kit: CliHarness, guards: readonly string[], command: string): Promise<CliResult> {
  return kit.run(['hook', 'guards', ...guards], { stdin: bash(command), env: ALPHA });
}

function alone(kit: CliHarness, guard: string, command: string): Promise<CliResult> {
  return kit.run(['hook', guard], { stdin: bash(command), env: ALPHA });
}

describe('hook guards (T5553, T5821)', () => {
  it('names the same guards as the runner lets run in a set, which may import neither', () => {
    assert.deepEqual([...setMembersOf({ table: COMMAND_TABLE }).keys()].sort(), [...SET_GUARDS].sort());
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

  it("gives no answer for a pass member that throws, while a guard's throw refuses the call, naming it (T5821)", async () => {
    const kit = new CliHarness();
    const broken = (): never => {
      throw new Error('broken member\nsecond line');
    };
    const allows: SetMember = { reply: () => ({ verdict: { kind: 'allow', reason: undefined } }), onThrow: 'pass' };
    const members = new Map<string, SetMember>([
      ['allow', allows],
      ['broken-pass', { reply: broken, onThrow: 'pass' }],
      ['broken-guard', { reply: broken, onThrow: 'refuse' }],
    ]);
    const passOnly = await runSet(kit, members, ['allow', 'broken-pass']);
    assert.equal(decisionOf(passOnly), 'allow');
    const withGuard = await runSet(kit, members, ['allow', 'broken-pass', 'broken-guard']);
    assert.equal(decisionOf(withGuard), 'deny');
    assert.equal(reasonOf(withGuard), failedGuardReason('broken-guard', 'broken member'));
    assert.deepEqual(await runSet(kit, members, ['broken-pass']), { code: EXIT.ok, stdout: [], stderr: [] });
  });

  it("allows a read-only line in a set as readonly-allow does alone, and a guard's refusal beats that allow (T5821)", async () => {
    const kit = new CliHarness(READONLY_TEAM);
    const withAllow = [...SHELL_SET, 'readonly-allow'];
    const read = await set(kit, withAllow, 'ls');
    assert.equal(decisionOf(read), 'allow');
    assert.deepEqual(read.stdout, (await alone(kit, 'readonly-allow', 'ls')).stdout);
    const push = 'git push origin main';
    assert.equal(decisionOf(await set(kit, withAllow, push)), 'deny');
    assert.equal(reasonOf(await set(kit, withAllow, push)), reasonOf(await alone(kit, 'push-guard', push)));
  });

  it('answers a route line in a set as route-allow does alone (T5821)', async () => {
    const kit = new CliHarness(ASKS_OFF);
    const route = 'git -C /w commit -s -m fix';
    const inSet = await set(kit, [...SHELL_SET, 'route-allow'], route);
    assert.equal(decisionOf(inSet), 'allow');
    assert.deepEqual(inSet.stdout, (await alone(kit, 'route-allow', route)).stdout);
  });

  it('gives nothing on a PowerShell call from route-allow and picker-guard, which watch Bash alone (T5821)', async () => {
    const kit = new CliHarness({ ...ASKS_OFF, pickerGuard: { enabled: true } });
    const stdin = JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'cd C:/w; git -C /w commit -s -m fix' }, cwd: APP });
    const result = await kit.run(['hook', 'guards', 'route-allow', 'picker-guard'], { stdin, env: ALPHA });
    assert.deepEqual(result, { code: EXIT.ok, stdout: [], stderr: [] });
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
