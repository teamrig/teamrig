import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APP, CLAUDE_SESSION, CliHarness, contextOf, TEAM, type CliResult } from '../../testing/cli-harness.ts';
import type { ParsedArgs } from '../args.ts';
import { EXIT } from '../runtime.ts';
import { AFTER_MEMBERS, afterSetOf, type AfterMemberLoad } from './hook-after-set.ts';

/** A token the write-time shapes know, built at run time so no file holds one. */
const TOKEN = ['gh', 'p_', 'a1'.repeat(18)].join('');
const AS_ALPHA = { TEAMRIG_SESSION: 'alpha' };

/** A Bash call's PostToolUse payload whose result printed `stdout`. */
function ran(stdout: string): string {
  return JSON.stringify({
    session_id: CLAUDE_SESSION,
    cwd: APP,
    hook_event_name: 'PostToolUse',
    tool_use_id: 'toolu_01',
    tool_name: 'Bash',
    tool_input: { command: 'run it' },
    tool_response: { stdout, stderr: '', interrupted: false, isImage: false },
  });
}

/** A Bash call's PostToolUseFailure payload, the shell having failed with `error`. */
function failed(error: string): string {
  return JSON.stringify({ session_id: CLAUDE_SESSION, cwd: APP, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'teamrig list' }, error });
}

/** A SendMessage call's PostToolUse payload, answered with `toolResponse`. */
function sent(to: string, toolResponse: unknown): string {
  return JSON.stringify({ session_id: CLAUDE_SESSION, cwd: APP, hook_event_name: 'PostToolUse', tool_name: 'SendMessage', tool_input: { to, message: 'the ask' }, tool_response: toolResponse });
}

const NOT_REACHABLE = { success: false, message: 'No agent named that is reachable.' };

/** `hook after <names>` over the given members, on `stdin`. */
async function runSet(kit: CliHarness, members: ReadonlyMap<string, AfterMemberLoad>, names: readonly string[], stdin: string): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = { stdout: (line: string) => stdout.push(line), stderr: (line: string) => stderr.push(line) };
  const args: ParsedArgs = { command: 'hook after', positionals: names, flags: new Map(), switches: new Set(), rest: [], help: false, common: new Map() };
  const code = await afterSetOf(members)(args, kit.runtime({ stdin, env: AS_ALPHA }, out));
  return { code, stdout, stderr };
}

/** A member that answers with `context` alone. */
const says = (context: string): AfterMemberLoad => async () => () => ({ context });

describe('hook after (T5821)', () => {
  it('names the five PostToolUse hooks that may share a process, each loading its reply', async () => {
    assert.deepEqual([...AFTER_MEMBERS.keys()].sort(), ['failed-send', 'loop-nudge', 'missing-cli', 'route-reminder', 'secret-redact']);
    for (const [name, load] of AFTER_MEMBERS) {
      assert.equal(typeof (await load()), 'function', name);
    }
  });

  it('gives a Bash result back redacted, as secret-redact alone does, with the shell set around it', async () => {
    const stdin = ran(`token ${TOKEN}`);
    const inSet = await new CliHarness(TEAM).run(['hook', 'after', 'secret-redact', 'loop-nudge', 'missing-cli'], { stdin, env: AS_ALPHA });
    const alone = await new CliHarness(TEAM).run(['hook', 'secret-redact'], { stdin, env: AS_ALPHA });
    assert.equal(inSet.code, EXIT.ok);
    assert.ok(!(inSet.stdout[0] ?? '').includes(TOKEN), 'the result still holds the token');
    assert.deepEqual(inSet.stdout, alone.stdout);
  });

  it("answers a shell's failure on PostToolUseFailure, as missing-cli alone does", async () => {
    const kit = new CliHarness(TEAM);
    const stdin = failed('Exit code 127\nbash: teamrig: command not found');
    const inSet = await kit.run(['hook', 'after', 'secret-redact', 'loop-nudge', 'missing-cli'], { stdin });
    assert.match(inSet.stdout[0] ?? '', /"hookEventName":"PostToolUseFailure"/);
    assert.deepEqual(inSet.stdout, (await kit.run(['hook', 'missing-cli'], { stdin })).stdout);
  });

  it('answers a failed send as failed-send alone does, with route-reminder beside it', async () => {
    const kit = new CliHarness(TEAM);
    const stdin = sent('app-alpha', NOT_REACHABLE);
    const inSet = await kit.run(['hook', 'after', 'failed-send', 'route-reminder'], { stdin });
    assert.ok(inSet.stdout.length === 1, 'the set answers once');
    assert.deepEqual(inSet.stdout, (await kit.run(['hook', 'failed-send'], { stdin })).stdout);
  });

  it("joins the members' lines for the model in the set's order", async () => {
    const kit = new CliHarness(TEAM);
    const members = new Map<string, AfterMemberLoad>([
      ['first', says('one')],
      ['second', says('two')],
    ]);
    assert.equal(contextOf(await runSet(kit, members, ['first', 'second'], ran('ok'))), 'one\n\ntwo');
    assert.equal(contextOf(await runSet(kit, members, ['second', 'first'], ran('ok'))), 'two\n\none');
  });

  it('lets the other members answer when one throws, naming it in one stderr line', async () => {
    const kit = new CliHarness(TEAM);
    const members = new Map<string, AfterMemberLoad>([
      ['fine', says('still here')],
      [
        'broken',
        async () => () => {
          throw new Error('broken member\nsecond line');
        },
      ],
      [
        'unloadable',
        async () => {
          throw new Error('no module');
        },
      ],
    ]);
    const result = await runSet(kit, members, ['broken', 'fine', 'unloadable'], ran('ok'));
    assert.equal(result.code, EXIT.ok);
    assert.equal(contextOf(result), 'still here');
    assert.deepEqual(result.stderr, ['teamrig hook after: broken gave no answer: broken member', 'teamrig hook after: unloadable gave no answer: no module']);
  });

  it('prints nothing for a result no member has a word about, nor for input that is no hook payload', async () => {
    const kit = new CliHarness(TEAM);
    const all = [...AFTER_MEMBERS.keys()];
    assert.deepEqual(await kit.run(['hook', 'after', ...all], { stdin: ran('ok'), env: AS_ALPHA }), { code: EXIT.ok, stdout: [], stderr: [] });
    assert.deepEqual(await kit.run(['hook', 'after', ...all], { stdin: 'not json' }), { code: EXIT.ok, stdout: [], stderr: [] });
  });

  it('refuses a set naming no hook, a hook twice, or a hook that runs only alone, as a usage error', async () => {
    const kit = new CliHarness(TEAM);
    for (const names of [[], ['loop-nudge', 'loop-nudge'], ['loop-nudge', 'tool-end']]) {
      const result = await kit.run(['hook', 'after', ...names], { stdin: ran('ok') });
      assert.equal(result.code, EXIT.usage, names.join(' '));
      assert.deepEqual(result.stdout, [], names.join(' '));
    }
  });
});
