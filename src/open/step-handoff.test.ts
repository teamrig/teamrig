import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handoffPipeOf, nodeStepHandoff, STEP_HANDOFF_VAR } from './step-handoff.ts';

const RUN = { command: '/usr/local/bin/claude', args: ['--name', 'app-alpha'], cwd: '/work/app', env: { PATH: '/usr/local/bin' } };

describe('step handoff', () => {
  it('reads the pipe number the launcher set, and nothing at or below stderr', () => {
    assert.equal(handoffPipeOf({ [STEP_HANDOFF_VAR]: '3' }), 3);
    for (const value of [undefined, '', '2', '0', '-3', '3a', '1.5']) {
      assert.equal(handoffPipeOf({ [STEP_HANDOFF_VAR]: value }), undefined, String(value));
    }
  });

  it('writes the plan as one JSON text to that pipe', async () => {
    const writes: { pipe: number; text: string }[] = [];
    const handoff = nodeStepHandoff({ [STEP_HANDOFF_VAR]: '3' }, (pipe, text) => writes.push({ pipe, text }));
    assert.deepEqual(await handoff.give(RUN), { kind: 'given' });
    assert.deepEqual(writes.map((write) => ({ pipe: write.pipe, run: JSON.parse(write.text) })), [{ pipe: 3, run: RUN }]);
  });

  it('writes nothing when no launcher started the step', async () => {
    const writes: number[] = [];
    const handoff = nodeStepHandoff({}, (pipe) => writes.push(pipe));
    assert.deepEqual(await handoff.give(RUN), { kind: 'none' });
    assert.deepEqual(writes, []);
  });

  it('says why a write failed, as when the pipe is closed', async () => {
    const handoff = nodeStepHandoff({ [STEP_HANDOFF_VAR]: '3' }, () => {
      throw new Error('EBADF: bad file descriptor, write');
    });
    assert.deepEqual(await handoff.give(RUN), { kind: 'failed', error: 'EBADF: bad file descriptor, write' });
  });
});
