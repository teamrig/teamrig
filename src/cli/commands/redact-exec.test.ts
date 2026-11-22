import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CliHarness, TEAM } from '../../testing/cli-harness.ts';

const FAKE_TOKEN = ['ghp', '_1234567890abcdefghijklmnopqrstuvwxyz'].join('');

describe('teamrig redact-exec', () => {
  it('runs the command and passes clean output through unchanged', async () => {
    const harness = new CliHarness();
    const res = await harness.run(['redact-exec', '--', 'echo', 'hello'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 0 }, output: 'hello world\n' }) },
    });
    assert.equal(res.code, 0);
    assert.deepEqual(res.stdout, ['hello world']);
    assert.deepEqual(res.stderr, []);
  });

  it('redacts secret shapes from output and warns on stderr without exposing the value', async () => {
    const harness = new CliHarness();
    const res = await harness.run(['redact-exec', '--', 'env'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 0 }, output: `token=${FAKE_TOKEN}\n` }) },
    });
    assert.equal(res.code, 0);
    assert.equal(res.stdout.length, 1);
    assert.equal(res.stdout[0]?.includes(FAKE_TOKEN), false);
    assert.match(res.stdout[0] ?? '', /\[redacted /);
    assert.equal(res.stderr.length, 1);
    assert.match(res.stderr[0] ?? '', /this result held a secret/);
  });

  it('leaves output unredacted when secretGuard.redact is false', async () => {
    const harness = new CliHarness({ ...TEAM, secretGuard: { redact: false } });
    const res = await harness.run(['redact-exec', '--', 'env'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 0 }, output: `token=${FAKE_TOKEN}\n` }) },
    });
    assert.equal(res.code, 0);
    assert.deepEqual(res.stdout, [`token=${FAKE_TOKEN}`]);
    assert.deepEqual(res.stderr, []);
  });

  it('propagates non-zero exit codes and signals as exit 1', async () => {
    const harness = new CliHarness();
    const failed = await harness.run(['redact-exec', '--', 'false'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 2 }, output: '' }) },
    });
    assert.equal(failed.code, 1);

    const signaled = await harness.run(['redact-exec', '--', 'sleep', '10'], {
      shell: { run: async () => ({ end: { kind: 'signal', signal: 'SIGTERM' }, output: '' }) },
    });
    assert.equal(signaled.code, 1);
  });
});
