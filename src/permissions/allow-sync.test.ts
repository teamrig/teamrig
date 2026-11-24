import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_TABLE } from '../cli/run.ts';
import type { JsonRecord } from '../core/guards.ts';
import type { HostPermissions } from '../ports/host/index.ts';
import { shippedPermissions } from '../testing/shipped-permissions.ts';
import { ALLOW_COMMANDS, allowRulesOf, allowRulesProbe, keepListOf, planAllowSync, ROUTE_COMMANDS, SYNC_EXCLUDED } from './allow-sync.ts';
import { KIT_SHAPES } from './route-kit.ts';
import { READ_ROUTE_COMMANDS } from './route-read.ts';

const PERMISSIONS = shippedPermissions();

/**
 * The synced set as the security reviewer read it (verdict T5156). A route command joining the S1 route lands here
 * only after that review: either list changing fails this spec until it does.
 */
const REVIEWED: readonly string[] = [
  'start',
  'set',
  'update',
  'verify',
  'list',
  'show',
  'check',
  'plan',
  'refresh',
  'inbox read',
  'inbox status',
  'inbox add',
  'who',
  'rename',
  'stats',
  'report done',
  'goal list',
  'goal show',
  'exec status',
  'team tree',
  'rules scan',
  'skills scorecard',
  'meeting list',
  'read',
  'roles list',
  'doctor',
  'issue similar',
  'config get',
  'config validate',
  'changes',
  'secrets staged',
  'stable-periods',
  'deploy-status',
];

function settings(allow: readonly string[]): JsonRecord {
  return { model: 'opus', permissions: { allow: [...allow], deny: ['Bash(rm *)'] }, env: { A: '1' } };
}

function allowOf(permissions: HostPermissions, json: JsonRecord | undefined): readonly string[] {
  assert.ok(json !== undefined, 'the plan writes nothing');
  const allow = permissions.read(json).allow;
  assert.ok(allow.ok, 'the written allow list does not read back');
  return allow.value;
}

describe('ALLOW_COMMANDS', () => {
  it('is the S1 route commands, register and read, less the excluded ones', () => {
    const route = new Set<string>([...KIT_SHAPES.register.commands, ...READ_ROUTE_COMMANDS.keys()]);
    assert.deepEqual(new Set(ROUTE_COMMANDS), route);
    for (const command of ALLOW_COMMANDS) {
      assert.ok(route.has(command), `${command} is no S1 route command`);
      assert.ok(!SYNC_EXCLUDED.has(command), `${command} is excluded`);
    }
  });

  it('excludes only route commands, each with its reason', () => {
    for (const [command, reason] of SYNC_EXCLUDED) {
      assert.ok(ROUTE_COMMANDS.includes(command), `${command} is excluded but no route command`);
      assert.notEqual(reason.trim(), '', `${command} has no reason`);
    }
  });

  it('is the set the security reviewer read', () => {
    assert.deepEqual([...ALLOW_COMMANDS].sort(), [...REVIEWED].sort());
  });

  it('holds no command whose words start another CLI command, since its rule would approve that one too', () => {
    const commands = Object.keys(COMMAND_TABLE.effects);
    for (const command of ALLOW_COMMANDS) {
      assert.ok(commands.includes(command), `${command} is no CLI command`);
      const wider = commands.filter((other) => other.startsWith(`${command} `));
      assert.deepEqual(wider, [], `a rule for ${command} would also approve ${wider.join(', ')}`);
    }
  });

  it('names each command once', () => {
    assert.equal(new Set(ALLOW_COMMANDS).size, ALLOW_COMMANDS.length);
  });

  it('gives every synced command its rule in each shell tool, so no command prompts in PowerShell alone (T5338)', () => {
    const rules = new Set(allowRulesOf(PERMISSIONS, ALLOW_COMMANDS));
    for (const command of ALLOW_COMMANDS) {
      for (const tool of ['Bash', 'PowerShell']) {
        assert.ok(rules.has(`${tool}(teamrig ${command} *)`), `${command} has no ${tool} rule`);
      }
    }
    assert.equal(rules.size, ALLOW_COMMANDS.length * 2);
  });
});

describe('allowRulesProbe', () => {
  it('names every rule missing from a file with no allow list', () => {
    assert.deepEqual(allowRulesProbe(PERMISSIONS, {}, []), {
      ok: true,
      value: { ok: false, missing: allowRulesOf(PERMISSIONS, ALLOW_COMMANDS), stale: [] },
    });
  });

  it('reads a file holding every rule as in order', () => {
    const synced = settings(['Read', ...allowRulesOf(PERMISSIONS, ALLOW_COMMANDS)]);
    assert.deepEqual(allowRulesProbe(PERMISSIONS, synced, []), { ok: true, value: { ok: true, missing: [], stale: [] } });
  });

  it("counts a person's rule of the same reach in the legacy form as there", () => {
    const handWritten = settings(['Bash(teamrig list:*)', 'PowerShell(MSYS_NO_PATHCONV=1 teamrig list *)']);
    assert.deepEqual(allowRulesProbe(PERMISSIONS, handWritten, [], ['list']), { ok: true, value: { ok: true, missing: [], stale: [] } });
  });

  it('names the owned rules no longer synced that the file still holds, never a rule it does not own', () => {
    const old = settings(['Bash(teamrig budget *)', 'PowerShell(teamrig budget *)', 'Bash(teamrig list *)', 'PowerShell(teamrig list *)']);
    const owned = ['Bash(teamrig budget *)', 'Bash(teamrig goal *)'];
    assert.deepEqual(allowRulesProbe(PERMISSIONS, old, owned, ['list']), { ok: true, value: { ok: false, missing: [], stale: ['Bash(teamrig budget *)'] } });
  });

  it("passes on the host's problem with an allow setting it cannot read", () => {
    const unread: HostPermissions = { ...PERMISSIONS, read: (json) => ({ ...PERMISSIONS.read(json), allow: { ok: false, problem: 'rules.allow is not a list' } }) };
    assert.deepEqual(allowRulesProbe(unread, {}, []), { ok: false, problem: 'rules.allow is not a list' });
  });
});

describe('planAllowSync', () => {
  it("adds the rules after the person's own and owns them, every other setting as it was", () => {
    const plan = planAllowSync(PERMISSIONS, settings(['Read', 'Bash(git status)']), []);
    assert.ok(plan.ok);
    const rules = allowRulesOf(PERMISSIONS, ALLOW_COMMANDS);
    assert.deepEqual(plan.value.added, rules);
    assert.deepEqual(plan.value.removed, []);
    assert.deepEqual(plan.value.owned, rules);
    assert.deepEqual(allowOf(PERMISSIONS, plan.value.settings), ['Read', 'Bash(git status)', ...rules]);
    assert.deepEqual({ ...plan.value.settings, permissions: undefined }, { ...settings([]), permissions: undefined });
  });

  it('changes nothing on a second run', () => {
    const first = planAllowSync(PERMISSIONS, settings([]), []);
    assert.ok(first.ok && first.value.settings !== undefined);
    assert.deepEqual(planAllowSync(PERMISSIONS, first.value.settings, first.value.owned), {
      ok: true,
      value: { settings: undefined, removed: [], added: [], owned: first.value.owned },
    });
  });

  it("on an update takes out only the owned rules no longer synced and adds the new ones, the person's kept in place", () => {
    const old = settings(['Bash(teamrig budget *)', 'Read', 'Bash(teamrig list *)', 'PowerShell(teamrig budget *)', 'PowerShell(teamrig list *)']);
    const owned = ['Bash(teamrig budget *)', 'Bash(teamrig list *)', 'PowerShell(teamrig list *)'];
    const plan = planAllowSync(PERMISSIONS, old, owned, ['list', 'show']);
    assert.ok(plan.ok);
    assert.deepEqual(plan.value.removed, ['Bash(teamrig budget *)']);
    assert.deepEqual(plan.value.added, ['Bash(teamrig show *)', 'PowerShell(teamrig show *)']);
    assert.deepEqual(plan.value.owned, ['Bash(teamrig list *)', 'PowerShell(teamrig list *)', 'Bash(teamrig show *)', 'PowerShell(teamrig show *)']);
    assert.deepEqual(allowOf(PERMISSIONS, plan.value.settings), [
      'Read',
      'Bash(teamrig list *)',
      'PowerShell(teamrig budget *)',
      'PowerShell(teamrig list *)',
      'Bash(teamrig show *)',
      'PowerShell(teamrig show *)',
    ]);
  });

  it('never takes over a rule the person wrote before the first sync, equal to a synced one', () => {
    const plan = planAllowSync(PERMISSIONS, settings(['Bash(teamrig list *)']), [], ['list']);
    assert.ok(plan.ok);
    assert.deepEqual([plan.value.added, plan.value.owned], [['PowerShell(teamrig list *)'], ['PowerShell(teamrig list *)']]);
  });

  it('puts back an owned rule the person took out, and drops an owned one gone from the file', () => {
    const plan = planAllowSync(PERMISSIONS, settings(['Bash(teamrig list *)']), ['Bash(teamrig list *)', 'PowerShell(teamrig list *)', 'Bash(teamrig budget *)'], ['list']);
    assert.ok(plan.ok);
    assert.deepEqual([plan.value.removed, plan.value.added], [[], ['PowerShell(teamrig list *)']]);
    assert.deepEqual(plan.value.owned, ['Bash(teamrig list *)', 'PowerShell(teamrig list *)']);
  });

  it("passes on the host's problem when it cannot write the allow setting", () => {
    const unwritten: HostPermissions = { ...PERMISSIONS, writeAllow: () => ({ ok: false, problem: 'rules are read only' }) };
    assert.deepEqual(planAllowSync(unwritten, settings([]), []), { ok: false, problem: 'rules are read only' });
  });
});

describe('keepListOf', () => {
  it("keeps the team's own rules and every synced rule, never another teamrig command's", () => {
    const keep = keepListOf(PERMISSIONS, ['WebSearch']);
    for (const rule of ['WebSearch', 'Bash(teamrig show *)', 'PowerShell(teamrig show:*)']) {
      assert.ok(keep.keeps(rule), `${rule} is not kept`);
    }
    for (const rule of ['Bash(teamrig add *)', 'Bash(teamrig budget lift *)', 'Read']) {
      assert.ok(!keep.keeps(rule), `${rule} is kept`);
    }
  });
});
