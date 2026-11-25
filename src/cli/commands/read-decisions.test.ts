import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonRecord } from '../../core/guards.ts';
import { INTERFACE_VERSION } from '../../interface/index.ts';
import { TEST_OWNER_CARD_FLAGS } from '../../testing/card.ts';
import { CliHarness, TEAM, type RunOptions } from '../../testing/cli-harness.ts';
import { rowsOf, served } from '../../testing/read-answers.ts';
import { treeHarness } from '../../testing/team-tree.ts';
import { EXIT } from '../runtime.ts';

const READ_DECISIONS = ['read', 'decisions', '--json'] as const;
const AS_WEB: RunOptions = { env: { TEAMRIG_TEAM: 'web' } };
const AS_OPS: RunOptions = { env: { TEAMRIG_TEAM: 'ops' } };

async function ok(kit: CliHarness, argv: readonly string[], options: RunOptions = {}): Promise<readonly string[]> {
  const result = await kit.run(argv, options);
  assert.equal(result.code, EXIT.ok, [...argv, ...result.stdout, ...result.stderr].join(' '));
  return result.stdout;
}

async function add(kit: CliHarness, title: string, owner: string, options: RunOptions = {}): Promise<void> {
  await ok(kit, ['add', '--session', 'lead', '--title', title, '--description', 'what and why', '--owner', owner, '--priority', 'p2'], options);
}

/** Sets task `id` waiting on the owner's decision as `session`, with `more` waits beside it. */
async function waitOnOwner(kit: CliHarness, id: string, session: string, more = '', options: RunOptions = {}): Promise<void> {
  await ok(kit, ['set', id, '--status', 'waiting', '--waits', `decision:owner${more}`, '--note', 'asked', ...TEST_OWNER_CARD_FLAGS, '--session', session], options);
}

function keysOf(answer: JsonRecord, group: string): string[] {
  return rowsOf(answer, group).map((row) => String(row['key']));
}

const GROUPS = ['pending', 'overdue', 'weekly', 'dedicated', 'later'] as const;

describe('read decisions', () => {
  it("serves the owner's batch group by group, a dedicated session's waits and a put-off card apart, and one session's with --owner", async () => {
    const kit = new CliHarness({ ...TEAM, decisions: { dedicatedOwners: ['bravo'] } });
    await add(kit, 'Pick the tier', 'alpha');
    await add(kit, 'Pick the region', 'alpha');
    await add(kit, 'Pick the name', 'bravo');
    await waitOnOwner(kit, 'T1', 'alpha');
    await waitOnOwner(kit, 'T2', 'alpha', ',time:2030-01-09 12:00');
    await waitOnOwner(kit, 'T3', 'bravo');
    const answer = served(await kit.run(READ_DECISIONS));
    assert.deepEqual([answer['interface'], answer['document'], answer['problems'], answer['askedBy']], [INTERFACE_VERSION, 'decisions', [], null]);
    assert.match(String(answer['revision']), /^[0-9a-f]{16}$/);
    assert.deepEqual(GROUPS.map((group) => keysOf(answer, group)), [['T1'], [], [], ['T3'], ['T2']]);
    const [first] = rowsOf(answer, 'pending');
    assert.deepEqual([first?.['owner'], first?.['team'], (first?.['card'] as JsonRecord | undefined)?.['question']], ['alpha', null, TEST_OWNER_CARD_FLAGS[1]]);
    const alpha = served(await kit.run([...READ_DECISIONS, '--owner', 'alpha']));
    assert.deepEqual(GROUPS.map((group) => keysOf(alpha, group)), [['T1'], [], [], [], ['T2']]);
  });

  it('answers unchanged while no file moved, and serves the batch again once a wait is set', async () => {
    const kit = new CliHarness();
    await add(kit, 'Pick the tier', 'alpha');
    await waitOnOwner(kit, 'T1', 'alpha');
    const held = String(served(await kit.run(READ_DECISIONS))['revision']);
    assert.deepEqual(served(await kit.run([...READ_DECISIONS, '--unless', `decisions=${held}`])), { interface: INTERFACE_VERSION, document: 'decisions', revision: held, unchanged: true });
    await add(kit, 'Pick the region', 'bravo');
    await waitOnOwner(kit, 'T2', 'bravo');
    const moved = served(await kit.run([...READ_DECISIONS, '--unless', `decisions=${held}`]));
    assert.deepEqual([moved['unchanged'], keysOf(moved, 'pending')], [undefined, ['T1', 'T2']]);
  });

  it("serves a team below the root its own waits of the root's batch, named as the root's lead asks them, and the root every one", async () => {
    const kit = await treeHarness();
    await add(kit, 'Pick the region', 'back', AS_WEB);
    await waitOnOwner(kit, 'T1', 'back', '', AS_WEB);
    const web = served(await kit.run(READ_DECISIONS, AS_WEB));
    assert.deepEqual([keysOf(web, 'pending'), rowsOf(web, 'pending')[0]?.['team']], [['web/T1'], 'web']);
    assert.notEqual(web['askedBy'], null, "the root's lead asks the owner web's waits");
    const root = served(await kit.run(READ_DECISIONS));
    assert.deepEqual([keysOf(root, 'pending'), root['askedBy']], [['web/T1'], null]);
  });

  it("serves a team under the root no sibling team's put-off waits, and the root every team's", async () => {
    const kit = await treeHarness();
    await add(kit, 'Pick the region', 'back', AS_WEB);
    await waitOnOwner(kit, 'T1', 'back', ',time:2030-01-09 12:00', AS_WEB);
    await add(kit, 'Pick the host', 'run', AS_OPS);
    await waitOnOwner(kit, 'T2', 'run', ',time:2030-01-09 12:00', AS_OPS);
    assert.deepEqual(keysOf(served(await kit.run(READ_DECISIONS, AS_WEB)), 'later'), ['web/T1']);
    assert.deepEqual(keysOf(served(await kit.run(READ_DECISIONS)), 'later').sort(), ['ops/T2', 'web/T1']);
  });
});
