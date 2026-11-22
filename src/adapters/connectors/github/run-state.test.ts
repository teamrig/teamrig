import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rerunRefusal, runStateOf, type RunState } from './run-state.ts';

const FAILED: RunState = { status: 'completed', conclusion: 'failure', workflow: 'ci.yml', event: 'push', attempt: 1 };

describe('runStateOf', () => {
  it("reads the status, conclusion, workflow file's name, event and attempt of an ended run and of one still going", () => {
    assert.deepEqual(
      runStateOf(JSON.stringify({ id: 7, status: 'completed', conclusion: 'failure', name: 'ci', path: '.github/workflows/ci.yml', event: 'push', run_attempt: 1 })),
      FAILED,
    );
    assert.deepEqual(
      runStateOf(JSON.stringify({ status: 'in_progress', conclusion: null, path: 'check.yml', event: 'pull_request', run_attempt: 2 })),
      { status: 'in_progress', conclusion: null, workflow: 'check.yml', event: 'pull_request', attempt: 2 },
    );
  });

  it('reads nothing from text that is no run, or a field that is missing or not a plain word', () => {
    const whole = { status: 'completed', conclusion: 'failure', path: '.github/workflows/ci.yml', event: 'push', run_attempt: 1 };
    const broken = [
      { ...whole, status: 7 },
      { ...whole, status: 'Completed!' },
      { ...whole, conclusion: 'fail\nure' },
      { ...whole, conclusion: undefined },
      { ...whole, path: undefined },
      { ...whole, path: 'ci.yml\u001b[2J' },
      { ...whole, path: '.github/workflows/' },
      { ...whole, event: undefined },
      { ...whole, event: 'Push now' },
      { ...whole, run_attempt: undefined },
      { ...whole, run_attempt: '1' },
      { ...whole, run_attempt: 0 },
      { ...whole, run_attempt: 1.5 },
    ];
    for (const stdout of ['', 'not json', '[]', '{}', ...broken.map((run) => JSON.stringify(run))]) {
      assert.equal(runStateOf(stdout), undefined, stdout);
    }
  });
});

describe('rerunRefusal', () => {
  it('lets a failed, cancelled or timed-out run of a push, pull request, merge queue or schedule be re-run', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
      for (const event of ['push', 'pull_request', 'merge_group', 'schedule']) {
        assert.equal(rerunRefusal('acme/web', 7, { ...FAILED, conclusion, event }), undefined, `${conclusion} ${event}`);
      }
    }
    assert.equal(rerunRefusal('acme/web', 7, { ...FAILED, attempt: 2 }), undefined);
  });

  it('refuses a passed run, naming the release it would publish again', () => {
    assert.equal(
      rerunRefusal('acme/web', 7, { ...FAILED, conclusion: 'success', workflow: 'release.yml' }),
      'run 7 of acme/web (release.yml, push, attempt 1) ended success: only a failed, cancelled or timed-out run is re-run (a passed release run would publish again); nothing was re-run',
    );
    for (const conclusion of ['skipped', 'neutral', 'action_required', 'stale', null]) {
      assert.notEqual(rerunRefusal('acme/web', 7, { ...FAILED, conclusion }), undefined, String(conclusion));
    }
  });

  it('refuses a run that has not ended', () => {
    assert.equal(
      rerunRefusal('acme/web', 7, { ...FAILED, status: 'in_progress', conclusion: null }),
      'run 7 of acme/web (ci.yml, push, attempt 1) is in_progress, not ended: re-run it once it ends failed, cancelled or timed out; nothing was re-run',
    );
    assert.notEqual(rerunRefusal('acme/web', 7, { ...FAILED, status: 'queued' }), undefined);
  });

  it('refuses a run a privileged or other event started, even one that failed', () => {
    assert.equal(
      rerunRefusal('acme/web', 7, { ...FAILED, event: 'pull_request_target', workflow: 'auto-merge.yml' }),
      "run 7 of acme/web (auto-merge.yml, pull_request_target, attempt 1) was started by pull_request_target: only a push, pull_request, merge_group or schedule run is re-run (a re-run takes the run's old workflow file with its token); nothing was re-run",
    );
    for (const event of ['workflow_run', 'workflow_dispatch', 'release', 'issue_comment']) {
      assert.notEqual(rerunRefusal('acme/web', 7, { ...FAILED, event }), undefined, event);
    }
  });

  it('refuses a run on its third attempt or later', () => {
    assert.equal(
      rerunRefusal('acme/web', 7, { ...FAILED, attempt: 3 }),
      'run 7 of acme/web (ci.yml, push, attempt 3) has run 3 times: a run is re-run at most twice; look at why it keeps failing; nothing was re-run',
    );
    assert.notEqual(rerunRefusal('acme/web', 7, { ...FAILED, attempt: 9 }), undefined);
  });
});
