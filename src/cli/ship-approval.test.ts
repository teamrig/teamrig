import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { CLAUDE_SESSION, CliHarness, TEAM, TEAM_HOME } from '../testing/cli-harness.ts';
import { treeHarness } from '../testing/team-tree.ts';
import { EXIT, RefusedError } from './runtime.ts';
import { testConfig } from '../testing/config.ts';
import { approversIn, mergeStandingOf, tabCallerOf } from './ship-approval.ts';

/** Team app with T1, alpha's, waiting on the lead's approval, which the lead gave. */
async function approved(): Promise<CliHarness> {
  const kit = new CliHarness();
  assert.equal((await kit.run(['add', '--title', 'Ship the CLI', '--description', 'what and why', '--priority', 'p1', '--session', 'alpha'])).code, EXIT.ok);
  assert.equal((await kit.run(['set', 'T1', '--status', 'waiting', '--waits', 'approval:lead', '--note', 'branch t1-cli', '--session', 'alpha'])).code, EXIT.ok);
  const answer = await kit.run(['approve', 'T1', '--note', 'head 0123456789abcdef checked', '--session', 'lead']);
  assert.equal(answer.code, EXIT.ok, answer.stderr.join('\n'));
  return kit;
}

describe('mergeStandingOf: who merges, its task and who approves it, read from the register (T2788)', () => {
  it("reads a member's task with the lead's answer, and its leaders as approvers", async () => {
    const kit = await approved();
    const standing = await mergeStandingOf(kit.runtime(), 'app', 'alpha', 'T1');
    assert.equal(standing.caller, 'alpha');
    assert.deepEqual(standing.approvers, ['lead']);
    assert.deepEqual([standing.task?.owner, standing.task?.status, standing.task?.answer?.verdict, standing.task?.answer?.by], ['alpha', 'waiting', 'approved', 'lead']);
    assert.equal(standing.task?.answer?.note, 'head 0123456789abcdef checked');
  });

  it('reads no task for an id the register does not hold', async () => {
    const kit = await approved();
    assert.equal((await mergeStandingOf(kit.runtime(), 'app', 'alpha', 'T9')).task, undefined);
  });

  it("names no approver for a root team's lead, whose own merge needs none", async () => {
    const kit = await approved();
    assert.deepEqual((await mergeStandingOf(kit.runtime(), 'app', 'lead', 'T1')).approvers, []);
  });

  it("names the parent team's lead as the approver of a child team's lead (T1140)", async () => {
    const kit = await treeHarness();
    assert.deepEqual((await mergeStandingOf(kit.runtime(), 'web', 'lead', 'T1')).approvers, ['app/lead']);
    assert.deepEqual((await mergeStandingOf(kit.runtime(), 'web', 'front', 'T1')).approvers, ['lead']);
  });

  it('refuses a caller that is no session of the team', async () => {
    const kit = await approved();
    await assert.rejects(mergeStandingOf(kit.runtime(), 'app', 'stranger', 'T1'), RefusedError);
  });

  it("refuses a child team's lead whose parent team has no config to name its approver", async () => {
    const kit = new CliHarness({ ...TEAM, team: { id: 'app', parent: 'gone' } });
    await assert.rejects(mergeStandingOf(kit.runtime(), 'app', 'lead', 'T1'), /team gone, the parent team, has no config/);
  });

  it('refuses a team whose config does not load', async () => {
    const kit = new CliHarness(null);
    await assert.rejects(mergeStandingOf(kit.runtime(), 'app', 'alpha', 'T1'), /config at .* is missing: the merge cannot tell who approves it/);
  });
});

describe('approversIn: whose approval clears a landing, from a loaded config (T4817)', () => {
  const ABOVE = { team: 'app', id: 'lead' };

  it("names a member's leaders, none for a root team's lead, and the parent's lead for a child team's lead", () => {
    assert.deepEqual(approversIn('app', testConfig(), 'alpha', undefined), ['lead']);
    assert.deepEqual(approversIn('app', testConfig(), 'lead', ABOVE), []);
    assert.deepEqual(approversIn('web', testConfig({ team: { id: 'web', parent: 'app' } }), 'lead', ABOVE), ['app/lead']);
  });

  it("refuses a child team's lead when no parent lead was read", () => {
    assert.throws(() => approversIn('web', testConfig({ team: { id: 'web', parent: 'app' } }), 'lead', undefined), /team app, the parent team, has no config/);
  });
});

/** Records that tab `claudeSession` read `area`'s inbox. */
async function mark(kit: CliHarness, area: string, hostSession: string = CLAUDE_SESSION): Promise<void> {
  const record = { v: 1, area, line: 0, at: '2030-01-08T09:00:00.000Z', claudeSession: hostSession, lastLineHash: null };
  await kit.files.append(join(TEAM_HOME, 'state', 'inbox-marks.jsonl'), `${JSON.stringify(record)}\n`);
}

describe('tabCallerOf: a merge runs for the session its tab is bound to (T2984, C4)', () => {
  it('names the session the tab is bound to, which the caller names', async () => {
    const kit = new CliHarness();
    await mark(kit, 'alpha');
    assert.equal(await tabCallerOf(kit.runtime(), 'app', CLAUDE_SESSION, 'alpha'), 'alpha');
  });

  it('refuses a caller its tab is not bound to, a tab with no mark, and a tab that read another inbox', async () => {
    const kit = new CliHarness();
    await mark(kit, 'alpha');
    await assert.rejects(tabCallerOf(kit.runtime(), 'app', CLAUDE_SESSION, 'bravo'), /this Claude Code tab is not bound to bravo alone/);
    await assert.rejects(tabCallerOf(kit.runtime(), 'app', 'ffffffff-0000-4000-8000-000000000001', 'alpha'), RefusedError);
    await mark(kit, 'bravo');
    await assert.rejects(tabCallerOf(kit.runtime(), 'app', CLAUDE_SESSION, 'alpha'), /not bound to alpha alone/);
  });

  it('refuses a team whose config does not load', async () => {
    await assert.rejects(tabCallerOf(new CliHarness(null).runtime(), 'app', CLAUDE_SESSION, 'alpha'), /config at .* is missing: the merge cannot tell which session its tab is/);
  });
});
