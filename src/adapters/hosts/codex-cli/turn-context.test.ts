import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newestRestriction, restrictionOf } from './turn-context.ts';

/** A rollout `turn_context` line with `payload`, as Codex writes one at a turn's start. */
function turnContext(payload: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ timestamp: '2030-01-08T09:58:00.000Z', type: 'turn_context', payload: { cwd: '/work', model: 'gpt', ...payload } });
}

const WORKSPACE = { type: 'workspace-write', writable_roots: [], network_access: false, exclude_tmpdir_env_var: false, exclude_slash_tmp: false };

describe('a Codex rollout turn_context as the restriction its turn ran under (T5089)', () => {
  it('reads the approval, the sandbox and its network, and the profile id', () => {
    assert.deepEqual(restrictionOf(turnContext({ approval_policy: 'never', sandbox_policy: WORKSPACE, active_permission_profile: { id: ':workspace' } })), {
      approval: 'never',
      sandbox: 'workspace-write',
      network: false,
      profile: ':workspace',
    });
  });

  it('reads each sandbox type, a network flag Codex left out as off', () => {
    const cases = [
      [{ type: 'danger-full-access' }, { sandbox: 'none', network: true }],
      [{ type: 'read-only' }, { sandbox: 'read-only', network: false }],
      [{ type: 'read-only', network_access: true }, { sandbox: 'read-only', network: true }],
      [{ ...WORKSPACE, network_access: true }, { sandbox: 'workspace-write', network: true }],
      [{ type: 'external-sandbox', network_access: 'enabled' }, { sandbox: 'external', network: true }],
      [{ type: 'external-sandbox', network_access: 'restricted' }, { sandbox: 'external', network: false }],
      [{ type: 'external-sandbox' }, { sandbox: 'external', network: false }],
    ] as const;
    for (const [policy, expected] of cases) {
      assert.deepEqual(restrictionOf(turnContext({ approval_policy: 'on-request', sandbox_policy: policy })), { approval: 'on-request', ...expected, profile: undefined }, policy.type);
    }
  });

  it('names a granular approval policy granular, and reads its older on-failure name', () => {
    const granular = { granular: { sandbox_approval: true, rules: false, skill_approval: true, request_permissions: false, mcp_elicitations: true } };
    const workspace = { sandbox: 'workspace-write', network: false, profile: undefined };
    assert.deepEqual(restrictionOf(turnContext({ approval_policy: granular, sandbox_policy: WORKSPACE })), { approval: 'granular', ...workspace });
    assert.deepEqual(restrictionOf(turnContext({ approval_policy: 'on-failure', sandbox_policy: WORKSPACE })), { approval: 'on-failure', ...workspace });
  });

  it('refuses a turn_context of a shape it does not know, never guessing its sandbox', () => {
    const shapes = [
      { approval_policy: 'sometimes', sandbox_policy: WORKSPACE },
      { approval_policy: 'never', sandbox_policy: { type: 'cloud' } },
      { approval_policy: 'never', sandbox_policy: { ...WORKSPACE, network_access: 'yes' } },
      { approval_policy: 'never' },
    ];
    for (const shape of shapes) {
      assert.equal(restrictionOf(turnContext(shape)), 'unknown', JSON.stringify(shape));
    }
  });

  it('reads no other line, a damaged one included', () => {
    for (const line of ['', '{"type":"event_msg","payload":{"type":"token_count"}}', '{"type":"turn_context"', 'turn_context']) {
      assert.equal(restrictionOf(line), undefined, line);
    }
  });
});

describe("the restriction of a rollout tail's newest turn (T5089)", () => {
  it('tells the last turn_context, past a cut first line and later lines of other kinds', () => {
    const tail = [
      'ad":"cut"}',
      turnContext({ approval_policy: 'on-request', sandbox_policy: { type: 'read-only' } }),
      turnContext({ approval_policy: 'never', sandbox_policy: WORKSPACE }),
      '{"type":"event_msg","payload":{"type":"token_count"}}',
      '',
    ].join('\n');
    assert.deepEqual(newestRestriction(tail), { approval: 'never', sandbox: 'workspace-write', network: false, profile: undefined });
  });

  it('tells nothing when the tail has no turn, or its newest is of an unknown shape, never an older turn in its place', () => {
    assert.equal(newestRestriction('{"type":"event_msg"}\n'), undefined);
    const tail = [turnContext({ approval_policy: 'never', sandbox_policy: WORKSPACE }), turnContext({ approval_policy: 'never', sandbox_policy: { type: 'cloud' } })].join('\n');
    assert.equal(newestRestriction(tail), undefined);
  });
});
