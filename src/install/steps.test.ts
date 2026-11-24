import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Sleep } from '../core/lock.ts';
import { checkInstall, INSTALL_CHECK_BASELINE, installLines, type InstallStep, type ProbeLimit, type StepResult } from './steps.ts';

/** A wait that never ends, so no probe in these specs runs past its limit. */
const neverEnds: Sleep = () => new Promise<void>(() => undefined);
const NO_TIMEOUT: ProbeLimit = { timeoutMs: 2_000, sleep: neverEnds };

function step(id: string, probe: InstallStep<string>['probe']): InstallStep<string> {
  return { id, title: `step ${id}`, addedIn: INSTALL_CHECK_BASELINE, probe };
}

describe('checkInstall', () => {
  it('runs every probe with the deps and keeps the steps in their order', async () => {
    const steps = [
      step('a', async (deps) => ({ kind: 'ok', detail: `a saw ${deps}` })),
      step('b', async () => ({ kind: 'missing', detail: 'b is not there', fix: 'add b' })),
    ];
    assert.deepEqual(await checkInstall(steps, 'machine', NO_TIMEOUT), [
      { id: 'a', title: 'step a', state: { kind: 'ok', detail: 'a saw machine' } },
      { id: 'b', title: 'step b', state: { kind: 'missing', detail: 'b is not there', fix: 'add b' } },
    ]);
  });

  it('reads a throwing probe as unknown, with its message, and still runs the others', async () => {
    const steps = [
      step('a', async () => {
        throw new Error('the disk is gone');
      }),
      step('b', async () => ({ kind: 'ok', detail: 'fine' })),
    ];
    const [thrown, other] = await checkInstall(steps, 'machine', NO_TIMEOUT);
    assert.deepEqual(thrown?.state, { kind: 'unknown', why: 'the disk is gone' });
    assert.deepEqual(other?.state, { kind: 'ok', detail: 'fine' });
  });

  it('reads a probe that runs past its limit as unknown, and still gives the others', async () => {
    const waits: number[] = [];
    const endsAtOnce: Sleep = async (ms) => {
      waits.push(ms);
    };
    const steps = [step('hung', () => new Promise(() => undefined)), step('quick', async () => ({ kind: 'ok', detail: 'fine' }))];
    const [hung, quick] = await checkInstall(steps, 'machine', { timeoutMs: 50, sleep: endsAtOnce });
    assert.deepEqual(hung?.state, { kind: 'unknown', why: 'the probe ran past 50 ms' });
    assert.deepEqual(quick?.state, { kind: 'ok', detail: 'fine' });
    assert.deepEqual(waits, [50, 50]);
  });
});

describe('installLines', () => {
  it('gives the counts, then one line per step with its detail and fix', () => {
    const results: StepResult[] = [
      { id: 'node', title: 'Node.js', state: { kind: 'ok', detail: 'Node.js 24 runs teamrig' } },
      { id: 'git', title: 'git on PATH', state: { kind: 'missing', detail: 'no git on PATH', fix: 'install git' } },
      { id: 'team', title: 'a team', state: { kind: 'unknown', why: 'the probe ran past 50 ms' } },
    ];
    assert.deepEqual(installLines(results), [
      'INSTALL 3 step(s): 1 ok, 1 missing, 1 unknown',
      '  OK node (Node.js): Node.js 24 runs teamrig',
      '  MISSING git (git on PATH): no git on PATH; fix: install git',
      '  UNKNOWN team (a team): the probe ran past 50 ms',
    ]);
  });
});
