import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TimeZone } from '../core/zone.ts';
import type { Task } from '../register/fold.ts';
import { NO_TASKS_ELSEWHERE } from '../register/tree.ts';
import { TEST_PARKING } from '../testing/ranking.ts';
import { testTask } from '../testing/task.ts';
import { decideWake, effectivePriority, NO_SETTLED_MOMENTS, type WakeRest, type WakeState } from './decide.ts';
import { isExemptFromRest, restExemptionOf, waitedOnByOthers } from './exempt.ts';

const NOW = Date.parse('2030-01-08T10:00:00.000Z');
const HELD: WakeRest = { held: true, quiet: false, yields: true };
const STOPPED: WakeRest = { held: true, quiet: false, yields: false };
const QUIET: WakeState = { tab: 'tab-1', known: [], pending: undefined, lastWakeAt: undefined, settled: NO_SETTLED_MOMENTS };

function tasksOf(...tasks: readonly Task[]): ReadonlyMap<string, Task> {
  return new Map(tasks.map((task) => [task.id, task]));
}

// alpha's p1 re-check waited for a time that has passed; beta waits on T1, nobody on T2.
const RECHECK = testTask({ id: 'T1', priority: 1, status: 'waiting', waits: [{ kind: 'time', at: '2030-01-08 09:00' }], ownerSeenAt: '2030-01-08T08:00:00.000Z' });
const LONE = testTask({ id: 'T2', priority: 1, status: 'waiting', waits: [{ kind: 'time', at: '2030-01-08 09:00' }], ownerSeenAt: '2030-01-08T08:00:00.000Z' });
const WAITER = testTask({ id: 'T3', owner: 'beta', status: 'waiting', waits: [{ kind: 'task', id: 'T1' }] });

describe('waitedOnByOthers', () => {
  it("names a task another session's active task waits on, not one its own owner waits on or a finished task did", () => {
    const own = testTask({ id: 'T4', status: 'waiting', waits: [{ kind: 'task', id: 'T2' }] });
    const finished = testTask({ id: 'T5', owner: 'beta', status: 'done', waits: [{ kind: 'task', id: 'T2' }] });
    assert.deepEqual([...waitedOnByOthers(tasksOf(RECHECK, LONE, WAITER, own, finished), NO_TASKS_ELSEWHERE)], ['T1']);
  });

  it('reads a waiter another register of the team tree holds', () => {
    const elsewhere = new Map([['T9', { team: 'child', task: testTask({ id: 'T9', owner: 'gamma', status: 'waiting', waits: [{ kind: 'task', id: 'T2' }] }) }]]);
    assert.deepEqual([...waitedOnByOthers(tasksOf(LONE), elsewhere)], ['T2']);
  });
});

describe('restExemptionOf', () => {
  const tasks = tasksOf(RECHECK, LONE, WAITER);

  it('exempts a task a leader marked exempt, which nobody waits on, up to the configured priority', () => {
    const marked = { ...LONE, exempt: 'lead' };
    const exemption = restExemptionOf(HELD, 1, tasks, NO_TASKS_ELSEWHERE);
    assert.equal(isExemptFromRest(marked, exemption), true);
    assert.equal(isExemptFromRest({ ...marked, priority: 2 }, exemption), false, 'past the configured priority');
    assert.equal(isExemptFromRest(marked, restExemptionOf(STOPPED, 1, tasks, NO_TASKS_ELSEWHERE)), false, 'never past a stop');
  });

  it('exempts the waited-on task up to the configured priority while the daily cap or a plain cut holds the session', () => {
    const exemption = restExemptionOf(HELD, 1, tasks, NO_TASKS_ELSEWHERE);
    assert.equal(isExemptFromRest(RECHECK, exemption), true);
    assert.equal(isExemptFromRest(LONE, exemption), false);
    assert.equal(isExemptFromRest({ ...RECHECK, priority: 2 }, exemption), false);
  });

  it('gives none to a stop, a pause, quiet hours or a session not held', () => {
    assert.equal(restExemptionOf(STOPPED, 1, tasks, NO_TASKS_ELSEWHERE), undefined);
    assert.equal(restExemptionOf({ held: true, quiet: true, yields: true }, 1, tasks, NO_TASKS_ELSEWHERE), undefined);
    assert.equal(restExemptionOf({ held: false, quiet: false }, 1, tasks, NO_TASKS_ELSEWHERE), undefined);
  });
});

describe('a held session and a cleared wait (T4948)', () => {
  const tasks = tasksOf(RECHECK, LONE, WAITER);
  const wakeFor = (rest: WakeRest): readonly string[] => {
    const decision = decideWake({
      tasks,
      elsewhere: NO_TASKS_ELSEWHERE,
      session: 'alpha',
      tab: 'tab-1',
      now: NOW,
      zone: TimeZone.UTC,
      maxPriority: effectivePriority(1, rest, undefined),
      exemption: restExemptionOf(rest, 1, tasks, NO_TASKS_ELSEWHERE),
      parking: TEST_PARKING,
      batchMs: 0,
      minGapMs: 0,
      maxGapMs: 0,
      previous: QUIET,
    });
    return decision.verdict.kind === 'wake' ? decision.verdict.tasks.map((task) => task.id) : [];
  };

  it('wakes its owner for the p1 task another session waits on, not for the one nobody waits on', () => {
    assert.deepEqual(wakeFor(HELD), ['T1']);
  });

  it('wakes it for neither under a stop', () => {
    assert.deepEqual(wakeFor(STOPPED), []);
  });
});
