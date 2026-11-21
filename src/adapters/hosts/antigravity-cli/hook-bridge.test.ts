import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hookBridge } from './hook-bridge.ts';
import { DOCS_BUILT_HOOK_INPUTS } from './testing/hook-inputs.ts';
import { toolCallShape } from './tool-call.ts';

const bridge = hookBridge(toolCallShape('linux'));

describe("Antigravity's hook bridge, given the event by the hook's command line (--host-event)", () => {
  const { preToolUseShell, postToolUseShell } = DOCS_BUILT_HOOK_INPUTS;

  it('reads the event the command line named from an input that names none', () => {
    const event = bridge.parse(JSON.stringify(preToolUseShell.input), 'PreToolUse');
    assert.equal(event?.name, 'tool-start');
    assert.equal(event?.hostName, 'PreToolUse');
    assert.equal(event?.call?.kind, 'shell');
  });

  it("takes the command line's event over a hookEventName in the input", () => {
    const event = bridge.parse(JSON.stringify({ ...postToolUseShell.input, hookEventName: 'Stop' }), 'PostToolUse');
    assert.equal(event?.name, 'tool-end');
  });

  it("reads no event from an input that does not fit the named event's shape, rather than act on a misread one", () => {
    const noCall = Object.fromEntries(Object.entries(preToolUseShell.input).filter(([key]) => key !== 'toolCall'));
    assert.equal(bridge.parse(JSON.stringify(noCall), 'PreToolUse'), undefined);
    assert.equal(bridge.parse(JSON.stringify({ ...preToolUseShell.input, stepIdx: 'three' }), 'PreToolUse'), undefined);
    assert.equal(bridge.parse(JSON.stringify(preToolUseShell.input), 'UserPromptSubmit'), undefined);
    assert.equal(bridge.parse('[]', 'PreToolUse'), undefined);
  });
});

describe("Antigravity's hook bridge", () => {
  it('returns undefined for invalid or non-object JSON', () => {
    assert.equal(bridge.parse(''), undefined);
    assert.equal(bridge.parse('{bad'), undefined);
    assert.equal(bridge.parse('[]'), undefined);
    assert.equal(bridge.parse('null'), undefined);
  });

  it('parses PreToolUse payload into HookEvent and ignores toolCall without name', () => {
    const event = bridge.parse(
      JSON.stringify({
        conversationId: 'ec33ebf9-0cba-4100-8142-c61503f6c587',
        workspacePaths: ['/repo'],
        transcriptPath: '/repo/.gemini/antigravity/transcript.jsonl',
        modelName: 'auto',
        lastUserInput: 'Fix the test',
        hookEventName: 'PreToolUse',
        cwd: '/repo',
        toolCall: { id: 'toolu_01', name: 'run_command', args: { CommandLine: 'npm test' } },
      }),
    );
    assert.equal(event?.name, 'tool-start');
    assert.equal(event?.session, 'ec33ebf9-0cba-4100-8142-c61503f6c587');
    assert.equal(event?.cwd, '/repo');
    assert.equal(event?.prompt, 'Fix the test');
    assert.equal(event?.call?.kind, 'shell');
    assert.equal(event?.call?.id, 'toolu_01');

    const noName = bridge.parse(JSON.stringify({ hookEventName: 'PreToolUse', workspacePaths: ['/repo'], toolCall: { args: {} } }));
    assert.equal(noName?.cwd, '/repo');
    assert.equal(noName?.call, undefined);
  });

  it('maps PostToolUse with error to tool-failed and Stop continuationActive', () => {
    const failed = bridge.parse(JSON.stringify({ hookEventName: 'PostToolUse', error: 'exit status 1' }));
    assert.equal(failed?.name, 'tool-failed');
    assert.equal(failed?.error, 'exit status 1');

    const stopped = bridge.parse(JSON.stringify({ hookEventName: 'Stop', continuationActive: true, terminationReason: 'NO_TOOL_CALL' }));
    assert.equal(stopped?.name, 'stop');
    assert.equal(stopped?.stopActive, true);
    assert.equal(stopped?.reason, 'NO_TOOL_CALL');
  });

  it('formats PreToolUse allow/deny replies', () => {
    assert.equal(bridge.reply('tool-start', {}), '');
    assert.deepEqual(JSON.parse(bridge.reply('tool-start', { verdict: { kind: 'allow', reason: 'safe read' } })), {
      decision: 'allow',
      reason: 'safe read',
    });
    assert.deepEqual(JSON.parse(bridge.reply('tool-start', { verdict: { kind: 'deny', reason: 'blocked push' } })), {
      decision: 'deny',
      reason: 'blocked push',
    });
  });

  it('formats SessionStart, PreInvocation, PostToolUse, Stop, and unknown event replies', () => {
    assert.deepEqual(JSON.parse(bridge.reply('session-start', { context: 'team rules' })), {
      injectSteps: [{ systemMessage: { systemMessage: 'team rules' } }],
    });
    assert.deepEqual(JSON.parse(bridge.reply('session-start', { notice: 'hello' })), {
      injectSteps: [{ systemMessage: { systemMessage: '', metadata: { user_markdown: 'hello' } } }],
    });
    assert.equal(bridge.reply('session-start', {}), '');

    assert.deepEqual(JSON.parse(bridge.reply('prompt', { verdict: { kind: 'allow' }, context: 'inbox note' })), {
      injectSteps: [{ systemMessage: { systemMessage: 'inbox note' } }],
    });
    assert.deepEqual(JSON.parse(bridge.reply('prompt', { verdict: { kind: 'block', reason: 'secret detected' } })), {
      injectSteps: [{ errorMessage: { userMessage: 'secret detected' } }],
      terminationBehavior: 'terminate',
    });
    assert.equal(bridge.reply('prompt', {}), '');

    assert.deepEqual(JSON.parse(bridge.reply('tool-end', { context: 'ignored' })), {});
    assert.deepEqual(JSON.parse(bridge.reply('stop', {})), {});
    assert.deepEqual(JSON.parse(bridge.reply('stop', { verdict: { kind: 'block', reason: 'keep going' } })), {
      decision: 'continue',
      reason: 'keep going',
    });
    assert.equal(bridge.reply('helper-start', { context: 'ignored' }), '');
  });
});
