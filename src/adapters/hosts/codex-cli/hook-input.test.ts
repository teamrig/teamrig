import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readApplyPatch } from './apply-patch.ts';
import { isSharedHookEvent, SHARED_HOOK_EVENTS } from './events.ts';
import { checkHookInput } from './hook-input.ts';
import { SOURCE_BUILT_HOOK_INPUTS, SOURCE_BUILT_PATCH } from './testing/hook-inputs.ts';

const FIXTURES = Object.entries(SOURCE_BUILT_HOOK_INPUTS);

function without(input: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(input).filter(([name]) => name !== key));
}

function reasonOf(payload: unknown): string {
  const check = checkHookInput(payload);
  assert.equal(check.ok, false);
  return check.ok ? '' : check.reason;
}

describe('the hook events teamrig and Codex share', () => {
  it('are 11, each named once', () => {
    assert.equal(SHARED_HOOK_EVENTS.length, 11);
    assert.equal(new Set(SHARED_HOOK_EVENTS).size, 11);
  });

  it('leave out the events only one of the two has', () => {
    for (const name of ['PostToolUseFailure', 'Elicitation', 'ElicitationResult', 'StopFailure', 'Interrupt', 'PreModelRequest']) {
      assert.equal(isSharedHookEvent(name), false, name);
    }
    assert.equal(isSharedHookEvent('PreToolUse'), true);
  });
});

describe('the source-built hook inputs', () => {
  it('cover every shared event', () => {
    const covered = new Set(FIXTURES.map(([, fixture]) => fixture.event));
    assert.deepEqual([...covered].sort(), [...SHARED_HOOK_EVENTS].sort());
  });

  for (const [name, fixture] of FIXTURES) {
    it(`${name} fits its event's shape with no field the schema does not name`, () => {
      assert.deepEqual(checkHookInput(fixture.input), { ok: true, event: fixture.event, unknownKeys: [] });
    });

    it(`${name} survives a trip through JSON, as Codex sends it`, () => {
      const sent: unknown = JSON.parse(JSON.stringify(fixture.input));
      assert.deepEqual(checkHookInput(sent), { ok: true, event: fixture.event, unknownKeys: [] });
    });
  }

  it('carry a patch the patch reader takes', () => {
    const reading = readApplyPatch(SOURCE_BUILT_PATCH);
    assert.equal(reading.ok, true);
    assert.deepEqual(reading.ok ? reading.operations.map((operation) => `${operation.kind} ${operation.path}`) : [], [
      'add notes/todo.md',
      'update src/app.ts',
    ]);
  });
});

describe('checkHookInput', () => {
  const shell = SOURCE_BUILT_HOOK_INPUTS.preToolUseShell.input;

  it('refuses what is not a JSON object', () => {
    for (const payload of [null, undefined, 'PreToolUse', 7, [shell]]) {
      assert.equal(reasonOf(payload), 'the hook input is not a JSON object');
    }
  });

  it('refuses an input that names no event, or names it with a non-text', () => {
    assert.equal(reasonOf(without(shell, 'hook_event_name')), 'the hook input has no hook_event_name');
    assert.equal(reasonOf({ ...shell, hook_event_name: 3 }), 'the hook input has no hook_event_name');
  });

  it('refuses an event teamrig has no hook for on Codex', () => {
    for (const name of ['Interrupt', 'PostToolUseFailure', 'pretooluse']) {
      assert.equal(
        reasonOf({ ...shell, hook_event_name: name }),
        `the hook input is for ${name}, an event teamrig has no hook for on Codex`,
      );
    }
  });

  for (const [name, fixture] of FIXTURES) {
    it(`refuses ${name} without any one field its event must carry`, () => {
      const input: Readonly<Record<string, unknown>> = fixture.input;
      const helperIsOptional = fixture.event !== 'SubagentStart' && fixture.event !== 'SubagentStop';
      for (const key of Object.keys(input)) {
        if (key === 'hook_event_name' || (helperIsOptional && (key === 'agent_id' || key === 'agent_type'))) {
          continue;
        }
        assert.equal(reasonOf(without(input, key)), `the ${fixture.event} hook input has no ${key}`);
      }
    });
  }

  it('takes a helper as optional where the main thread fires the event too', () => {
    const inHelper = SOURCE_BUILT_HOOK_INPUTS.preToolUseShellInHelper.input;
    assert.equal(checkHookInput(without(inHelper, 'agent_id')).ok, true);
    assert.equal(checkHookInput(without(inHelper, 'agent_type')).ok, true);
  });

  it('refuses an optional field of the wrong type', () => {
    assert.equal(reasonOf({ ...shell, agent_id: 12 }), 'the PreToolUse hook input holds a agent_id that is not a string');
  });

  it('refuses a field of the wrong type, naming what it must be', () => {
    assert.equal(reasonOf({ ...shell, tool_name: null }), 'the PreToolUse hook input holds a tool_name that is not a string');
    assert.equal(
      reasonOf({ ...shell, transcript_path: 4 }),
      'the PreToolUse hook input holds a transcript_path that is not a string or null',
    );
    assert.equal(
      reasonOf({ ...SOURCE_BUILT_HOOK_INPUTS.stop.input, stop_hook_active: 'no' }),
      'the Stop hook input holds a stop_hook_active that is not a boolean',
    );
  });

  it('refuses a word outside the list its field takes', () => {
    assert.equal(
      reasonOf({ ...shell, permission_mode: 'yolo' }),
      'the PreToolUse hook input holds a permission_mode that is not one of default, acceptEdits, plan, dontAsk, bypassPermissions',
    );
    assert.equal(
      reasonOf({ ...SOURCE_BUILT_HOOK_INPUTS.sessionStart.input, source: 'reboot' }),
      'the SessionStart hook input holds a source that is not one of startup, resume, clear, compact, fork',
    );
    assert.equal(
      reasonOf({ ...SOURCE_BUILT_HOOK_INPUTS.sessionEnd.input, reason: 'logout' }),
      'the SessionEnd hook input holds a reason that is not one of other',
    );
    assert.equal(
      reasonOf({ ...SOURCE_BUILT_HOOK_INPUTS.preCompact.input, trigger: 7 }),
      'the PreCompact hook input holds a trigger that is not one of manual, auto',
    );
  });

  it('takes any value as a tool input or response, null too, but not its absence', () => {
    const done = SOURCE_BUILT_HOOK_INPUTS.postToolUseShell.input;
    assert.equal(checkHookInput({ ...done, tool_input: null, tool_response: { exit_code: 0 } }).ok, true);
    assert.equal(reasonOf(without(done, 'tool_response')), 'the PostToolUse hook input has no tool_response');
  });

  it('reports a field 0.170.0 does not name and still takes the input', () => {
    assert.deepEqual(checkHookInput({ ...shell, effort: 'high', sandbox: null }), {
      ok: true,
      event: 'PreToolUse',
      unknownKeys: ['effort', 'sandbox'],
    });
  });

  it('holds a permission request to no tool_use_id, which its schema lacks', () => {
    assert.deepEqual(checkHookInput({ ...SOURCE_BUILT_HOOK_INPUTS.permissionRequest.input, tool_use_id: 'call_shell_1' }), {
      ok: true,
      event: 'PermissionRequest',
      unknownKeys: ['tool_use_id'],
    });
  });
});
