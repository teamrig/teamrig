import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HookEventName, HookReply, JsonRecord, ToolCall, ToolCallShape } from '../../../plugin-api/index.ts';
import type { SharedHookEvent } from './events.ts';
import { hookBridge } from './hook-bridge.ts';
import { codexReply } from './reply.ts';
import { SOURCE_BUILT_HOOK_INPUTS } from './testing/hook-inputs.ts';

/** A shape that names every call `other`, so these specs read the bridge and not a tool's reading. */
const plainShape: ToolCallShape = {
  normalize: (name: string, input: JsonRecord): ToolCall => ({ kind: 'other', name, input }),
};

const bridge = hookBridge(plainShape);

const SESSION = SOURCE_BUILT_HOOK_INPUTS.sessionStart.input.session_id;

function parse(payload: object): ReturnType<typeof bridge.parse> {
  return bridge.parse(JSON.stringify(payload));
}

function replyOf(on: HookEventName, reply: HookReply): unknown {
  const text = bridge.reply(on, reply);
  return text === '' ? undefined : JSON.parse(text);
}

const DENY = { kind: 'deny', reason: 'not on this branch' } as const;
const BLOCK = { kind: 'block', reason: 'finish the task first' } as const;
const ALLOW = { kind: 'allow' } as const;

describe("Codex CLI's hook input", () => {
  it('is no event when it is not a JSON object', () => {
    for (const raw of ['', '{"session_id":', '[1, 2]', '"text"', 'null']) {
      assert.equal(bridge.parse(raw), undefined, raw);
    }
  });

  it('names each source-built event as the core does', () => {
    const names: Readonly<Record<SharedHookEvent, HookEventName>> = {
      SessionStart: 'session-start',
      SessionEnd: 'session-end',
      UserPromptSubmit: 'prompt',
      PreToolUse: 'tool-start',
      PermissionRequest: 'permission-prompt',
      PostToolUse: 'tool-end',
      Stop: 'stop',
      SubagentStart: 'helper-start',
      SubagentStop: 'helper-stop',
      PreCompact: 'compact-start',
      PostCompact: 'compact-end',
    };
    for (const [key, fixture] of Object.entries(SOURCE_BUILT_HOOK_INPUTS)) {
      const event = parse(fixture.input);
      assert.equal(event?.name, names[fixture.event], key);
      assert.equal(event?.hostName, fixture.event, key);
      assert.equal(event?.session, SESSION, key);
      assert.equal(event?.cwd, '/work/project', key);
    }
  });

  it('names an event Codex fires and teamrig does not know other', () => {
    assert.equal(parse({ hook_event_name: 'Notification' })?.name, 'other');
    assert.equal(parse({})?.name, 'other');
  });

  it('reads the tool call with its id and answer', () => {
    const start = parse(SOURCE_BUILT_HOOK_INPUTS.preToolUseShell.input);
    assert.deepEqual(start?.call, { kind: 'other', name: 'Bash', input: { command: 'git status --short' }, id: 'call_shell_1' });
    const end = parse(SOURCE_BUILT_HOOK_INPUTS.postToolUseShell.input);
    assert.equal(end?.call?.response, ' M src/app.ts\n');
    assert.equal(end?.call?.replaceable, undefined);
  });

  it('reads the helper a hook came from, and none on the main thread', () => {
    assert.deepEqual(parse(SOURCE_BUILT_HOOK_INPUTS.subagentStop.input)?.helper, {
      id: '0198c1d3-11aa-7b52-a6c4-2d3e4f5a6b7c',
      type: 'explorer',
      transcript: '/work/codex-home/sessions/2026/11/20/rollout-0198c1d3.jsonl',
    });
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.preToolUseShell.input)?.helper, undefined);
  });

  it('reads the prompt, last reply, stop flag, source and trigger', () => {
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.userPromptSubmit.input)?.prompt, 'What is next on my list?');
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.subagentStop.input)?.lastReply, 'Two files read; nothing to change.');
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.stop.input)?.lastReply, undefined);
    assert.equal(parse({ hook_event_name: 'Stop', stop_hook_active: true })?.stopActive, true);
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.sessionStart.input)?.source, 'startup');
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.preCompact.input)?.trigger, 'auto');
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.sessionStartWithNoTranscript.input)?.transcript, undefined);
  });

  it('reads a field of the wrong type as absent and keeps the rest of the event', () => {
    const event = parse({ hook_event_name: 'PreToolUse', session_id: 7, cwd: ['x'], tool_name: 'Bash', tool_input: 'rm -rf /' });
    assert.equal(event?.name, 'tool-start');
    assert.equal(event?.session, undefined);
    assert.equal(event?.cwd, undefined);
    assert.deepEqual(event?.call, { kind: 'other', name: 'Bash', input: {} });
  });

  it('reads a session id that is no thread id as no session', () => {
    for (const session_id of ['abc', SESSION.toUpperCase(), `${SESSION}0`, '../../etc']) {
      assert.equal(parse({ hook_event_name: 'Stop', session_id })?.session, undefined, session_id);
    }
  });

  it('names no environment switch that leaves the tab title to hooks', () => {
    assert.equal(bridge.titleSwitch, undefined);
  });
});

describe('the reply Codex CLI reads', () => {
  it('denies a tool call before it runs, and leaves an allow to Codex', () => {
    assert.deepEqual(replyOf('tool-start', { verdict: DENY }), {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'not on this branch' },
    });
    assert.equal(replyOf('tool-start', { verdict: ALLOW }), undefined);
    assert.equal(replyOf('tool-start', {}), undefined);
  });

  it('answers the approval prompt with allow or deny', () => {
    assert.deepEqual(replyOf('permission-prompt', { verdict: ALLOW }), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    assert.deepEqual(replyOf('permission-prompt', { verdict: DENY }), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'not on this branch' } },
    });
    assert.equal(replyOf('permission-prompt', {}), undefined);
  });

  it('blocks at the top where Codex reads a block', () => {
    for (const on of ['prompt', 'tool-end', 'stop', 'helper-stop'] as const) {
      assert.deepEqual(replyOf(on, { verdict: BLOCK }), { decision: 'block', reason: 'finish the task first' }, on);
    }
  });

  it('stops a compaction with continue false', () => {
    assert.deepEqual(replyOf('compact-start', { verdict: BLOCK }), { continue: false, stopReason: 'finish the task first' });
  });

  it('gives a refusal with a blank reason a reason, so it still refuses', () => {
    assert.deepEqual(replyOf('stop', { verdict: { kind: 'block', reason: '  ' } }), {
      decision: 'block',
      reason: 'A teamrig hook refused this and gave no reason.',
    });
  });

  it('hands context to the model only where Codex takes it', () => {
    const takers: readonly (readonly [HookEventName, SharedHookEvent])[] = [
      ['session-start', 'SessionStart'],
      ['prompt', 'UserPromptSubmit'],
      ['tool-start', 'PreToolUse'],
      ['tool-end', 'PostToolUse'],
      ['helper-start', 'SubagentStart'],
    ];
    for (const [on, hookEventName] of takers) {
      assert.deepEqual(replyOf(on, { context: 'T12 is next' }), { hookSpecificOutput: { hookEventName, additionalContext: 'T12 is next' } }, on);
    }
    assert.equal(replyOf('stop', { context: 'T12 is next' }), undefined);
    assert.equal(replyOf('permission-prompt', { context: 'T12 is next' }), undefined);
  });

  it('shows the human a notice', () => {
    assert.deepEqual(replyOf('compact-end', { notice: 'compacted' }), { systemMessage: 'compacted' });
  });

  it('writes nothing at a session end, for an event Codex lacks, or for fields Codex has no place for', () => {
    assert.equal(bridge.reply('session-end', { notice: 'bye', verdict: BLOCK }), '');
    assert.equal(bridge.reply('tool-failed', { notice: 'failed' }), '');
    assert.equal(bridge.reply('stop', { tabTitle: 'T12', sessionTitle: 'T12', toolOutput: { text: 'x' } }), '');
  });

  it('writes only replies Codex takes whole, so none of its fields is dropped', () => {
    const cases: readonly (readonly [HookEventName, SharedHookEvent, HookReply])[] = [
      ['session-start', 'SessionStart', { context: 'c', notice: 'n' }],
      ['prompt', 'UserPromptSubmit', { verdict: BLOCK, context: 'c', notice: 'n' }],
      ['tool-start', 'PreToolUse', { verdict: DENY, context: 'c', notice: 'n' }],
      ['permission-prompt', 'PermissionRequest', { verdict: DENY, notice: 'n' }],
      ['permission-prompt', 'PermissionRequest', { verdict: ALLOW }],
      ['tool-end', 'PostToolUse', { verdict: BLOCK, context: 'c', notice: 'n' }],
      ['stop', 'Stop', { verdict: BLOCK, notice: 'n' }],
      ['helper-start', 'SubagentStart', { context: 'c' }],
      ['helper-stop', 'SubagentStop', { verdict: BLOCK }],
      ['compact-start', 'PreCompact', { verdict: BLOCK, notice: 'n' }],
      ['compact-end', 'PostCompact', { notice: 'n' }],
    ];
    for (const [on, host, reply] of cases) {
      const text = bridge.reply(on, reply);
      const read = codexReply(host, text);
      assert.deepEqual(read.dropped, [], on);
      assert.deepEqual(JSON.parse(read.stdout), JSON.parse(text), on);
    }
  });
});

describe("the permission mode in Codex CLI's hook input", () => {
  it('maps each word its 0.170.0 hook schemas list, and keeps the word', () => {
    const modes = { default: 'ask', acceptEdits: 'accept-edits', plan: 'plan', dontAsk: 'no-prompts', bypassPermissions: 'bypass' } as const;
    for (const [word, mode] of Object.entries(modes)) {
      assert.deepEqual(parse({ ...SOURCE_BUILT_HOOK_INPUTS.sessionStart.input, permission_mode: word })?.permission, { mode, hostWord: word }, word);
    }
  });

  it('keeps a word the schemas do not list as unmapped', () => {
    for (const word of ['auto', 'yolo', 'DontAsk']) {
      assert.deepEqual(parse({ ...SOURCE_BUILT_HOOK_INPUTS.sessionStart.input, permission_mode: word })?.permission, { mode: 'unmapped', hostWord: word }, word);
    }
  });

  it('reports none for an event that carries no mode', () => {
    assert.equal(parse(SOURCE_BUILT_HOOK_INPUTS.sessionEnd.input)?.permission, undefined);
  });
});
