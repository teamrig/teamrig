import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FOCUS } from '../config/defaults.ts';
import { SecretScanner } from '../core/secrets.ts';
import { TimeZone } from '../core/zone.ts';
import { decisionBatch, type BatchRegister, type DecisionBatch, type OwnerWait } from '../decisions/batch.ts';
import { cardLabel } from '../meeting/decision-order.ts';
import type { Task } from '../register/fold.ts';
import { TaskTree } from '../register/tree.ts';
import { TEST_OWNER_CARD } from '../testing/card.ts';
import { testTask } from '../testing/task.ts';
import { decisionsBody, type DecisionsBody, type ServedOwnerWait } from './decisions.ts';

/** A Tuesday; the batch's Improvements day is a Wednesday, so a wait that frees only Improvements work is held. */
const NOW = Date.parse('2030-01-08T10:00:00Z');
const TIMES = ['13:03', '19:03'];
/** A text one of teamrig's own secret shapes matches, built from parts so this file holds none. */
const TOKEN = ['pass', 'word', '=', 'hunter2'].join('');

/** A task waiting on the owner's decision since `statusAt`, with a card naming its gate. */
function ownerWait(id: string, statusAt: string, overrides: Partial<Task> = {}): Task {
  return testTask({ id, status: 'waiting', waits: [{ kind: 'decision', who: 'owner' }], card: TEST_OWNER_CARD, statusAt, ...overrides });
}

function registerOf(tasks: readonly Task[], team?: string, dedicatedOwners: readonly string[] = []): BatchRegister {
  const tree = new TaskTree(new Map(tasks.map((task) => [task.id, task])), new Date(NOW), TimeZone.UTC);
  return { team, tasks, tree, ownerMarker: 'owner', requireGate: true, focus: DEFAULT_FOCUS, dedicatedOwners };
}

function batchOf(registers: readonly BatchRegister[], askedAt?: string): DecisionBatch {
  return decisionBatch({ registers, now: NOW, askedAt: askedAt === undefined ? undefined : Date.parse(askedAt), config: { batchTimesUtc: TIMES, batchAt: 5 }, improvementsDay: 'wed' });
}

function bodyOf(batch: DecisionBatch, askedBy: string | null = null): DecisionsBody {
  return decisionsBody({ batch, askedBy, now: NOW, shapes: new SecretScanner() });
}

const keys = (rows: readonly ServedOwnerWait[]): string[] => rows.map((row) => row.key);
const batchKeys = (waits: readonly OwnerWait[]): string[] => waits.map((wait) => cardLabel(wait.team, wait.task.id));

describe('decisionsBody', () => {
  it("serves the batch's waits in its own order, each with its due, its waits and what its answer frees", () => {
    const own = [
      ownerWait('T1', '2030-01-08T09:00:00.000Z', { due: '2030-01-08 12:00' }),
      testTask({ id: 'T2', owner: 'bravo', status: 'in-progress', after: ['T1'] }),
      ownerWait('T3', '2030-01-07T11:00:00.000Z', { due: '2030-01-07' }),
    ];
    const batch = batchOf([registerOf(own), registerOf([ownerWait('T9', '2030-01-08T09:30:00.000Z')], 'web')], '2030-01-07T12:00:00.000Z');
    const body = bodyOf(batch, 'root:lead');
    assert.deepEqual([keys(body.pending), keys(body.overdue)], [batchKeys(batch.pending), batchKeys(batch.overdue)]);
    assert.deepEqual([keys(body.pending), keys(body.overdue)], [['T1', 'web/T9'], ['T3']]);
    const [first, web] = body.pending;
    assert.deepEqual(
      { id: first?.id, team: first?.team, owner: first?.owner, status: first?.status, waits: first?.waits, due: first?.due, frees: first?.frees, later: first?.later },
      {
        id: 'T1',
        team: null,
        owner: 'alpha',
        status: 'waiting',
        waits: [{ kind: 'decision', who: 'owner' }],
        due: { due: '2030-01-08 12:00', at: '2030-01-08T12:00:00.000Z', from: null },
        frees: [{ id: 'T2', team: null, owner: 'bravo', status: 'in-progress' }],
        later: null,
      },
    );
    assert.deepEqual([web?.id, web?.team, web?.frees], ['T9', 'web', []]);
    assert.deepEqual(body.trigger, { kind: 'deadline', key: 'T1', at: '2030-01-08T12:00:00.000Z' }, 'T1 is due before the next batch');
    assert.deepEqual([body.at, body.nextBatchAt, body.validUntil], ['2030-01-08T10:00:00.000Z', '2030-01-08T13:03:00.000Z', '2030-01-08T12:00:00.000Z']);
    assert.deepEqual([body.askedBy, body.improvementsDay, body.cuts], ['root:lead', 'wed', []]);
  });

  it('places a held Improvements wait, a dedicated owner and a put-off card as the batch places them', () => {
    const tasks = [
      ownerWait('T4', '2030-01-08T09:00:00.000Z', { workClass: 'Improvements' }),
      ownerWait('T5', '2030-01-08T09:00:00.000Z', { owner: 'pricing' }),
      ownerWait('T6', '2030-01-06T09:00:00.000Z', { waits: [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2030-01-09 12:00' }] }),
    ];
    const batch = batchOf([registerOf(tasks, undefined, ['pricing'])]);
    const body = bodyOf(batch);
    const placed = [keys(body.pending), keys(body.weekly), keys(body.dedicated), keys(body.later)];
    assert.deepEqual(placed, [batchKeys(batch.pending), batchKeys(batch.weekly), batchKeys(batch.dedicated), batchKeys(batch.later)]);
    assert.deepEqual(placed, [[], ['T4'], ['T5'], ['T6']]);
    assert.deepEqual(body.later[0]?.later, { until: '2030-01-09 12:00', at: '2030-01-09T12:00:00.000Z' });
    assert.equal(body.trigger, null);
    assert.equal(body.validUntil, '2030-01-08T13:03:00.000Z', 'the next batch time comes before the card is back');
  });

  it('turns at the next UTC midnight when nothing sooner does, for the Improvements day', () => {
    const batch = decisionBatch({ registers: [registerOf([ownerWait('T4', '2030-01-08T09:00:00.000Z', { workClass: 'Improvements' })])], now: NOW, askedAt: undefined, config: { batchTimesUtc: [], batchAt: 5 }, improvementsDay: 'wed' });
    assert.deepEqual([bodyOf(batch).validUntil, bodyOf(batch).nextBatchAt], ['2030-01-09T00:00:00.000Z', null]);
  });

  it("cuts a card text holding a secret's shape under the batch's key, and serves a run file by its name and pinned sha256 alone", () => {
    const sha256 = 'ab'.repeat(32);
    const pinned = ownerWait('T7', '2030-01-08T09:00:00.000Z', {
      card: { ...TEST_OWNER_CARD, run: '/home/someone/steps/grant.sh' },
      audits: [{ path: '/home/someone/steps/grant.sh', sha256, by: 'security', at: '2030-01-08T08:00:00.000Z' }],
    });
    const leaked = ownerWait('T8', '2030-01-08T09:00:00.000Z', { card: { ...TEST_OWNER_CARD, question: `Rotate ${TOKEN} now`, run: 'C:\\steps\\other.ps1' } });
    const body = bodyOf(batchOf([registerOf([pinned]), registerOf([leaked], 'web')]));
    const shape = new SecretScanner().find(TOKEN)?.description;
    assert.ok(shape !== undefined);
    const [own, web] = body.pending;
    assert.deepEqual([own?.card?.run, web?.card?.run], [{ file: 'grant.sh', sha256 }, { file: 'other.ps1', sha256: null }]);
    assert.equal(web?.card?.question, `[cut: ${shape}]`);
    assert.deepEqual(body.cuts, [{ id: 'web/T8', field: 'card.question', shape }]);
    assert.doesNotMatch(JSON.stringify(body), /someone|steps[\\/]/, 'no part of a run path but its file name is served');
  });

  it("serves the sha256 of the run file's own audit, never another file's audit on the task", () => {
    const run = '/home/someone/steps/grant.sh';
    const own = { path: run, sha256: 'ab'.repeat(32), by: 'security', at: '2030-01-08T08:00:00.000Z' };
    const other = { path: '/home/someone/steps/revoke.sh', sha256: 'cd'.repeat(32), by: 'security', at: '2030-01-08T08:30:00.000Z' };
    const both = ownerWait('T7', '2030-01-08T09:00:00.000Z', { card: { ...TEST_OWNER_CARD, run }, audits: [own, other] });
    const otherOnly = ownerWait('T8', '2030-01-08T09:00:00.000Z', { card: { ...TEST_OWNER_CARD, run }, audits: [other] });
    const runs = bodyOf(batchOf([registerOf([both, otherOnly])])).pending.map((row) => row.card?.run);
    assert.deepEqual(runs, [{ file: 'grant.sh', sha256: own.sha256 }, { file: 'grant.sh', sha256: null }]);
  });
});
