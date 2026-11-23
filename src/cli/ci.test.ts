import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRunRerun } from '../adapters/connectors/github/gh.ts';
import { CliHarness, TEAM } from '../testing/cli-harness.ts';
import { FakeGh } from '../testing/fake-gh.ts';
import { EXIT } from './runtime.ts';

describe('teamrig ci rerun (T5063)', () => {
  const AS_ALPHA = { env: { TEAMRIG_SESSION: 'alpha' } };
  const kit = (): CliHarness => new CliHarness({ ...TEAM, github: { repos: ['acme/web'] } });

  /** The re-runs `gh` took. */
  function reruns(gh: FakeGh): readonly (readonly string[])[] {
    return gh.ran.map((request) => request.args).filter((args) => isRunRerun(args));
  }

  it('re-runs the failed jobs of the named run of a team repository, with its saved key, naming its workflow, event and attempt', async () => {
    const gh = new FakeGh().holdsRun(45027704561, 'completed', 'failure');
    const result = await kit().run(['ci', 'rerun', 'Acme/Web', '--run', '45027704561'], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, ['RERUN acme/web run 45027704561 (ci.yml, push): its failed jobs started again as attempt 2']);
    assert.deepEqual(reruns(gh), [['api', 'repos/acme/web/actions/runs/45027704561/rerun-failed-jobs', '-X', 'POST']]);
  });

  it('refuses, re-running nothing, a run that passed', async () => {
    const gh = new FakeGh().holdsRun(7, 'completed', 'success', { workflow: '.github/workflows/release.yml' });
    const result = await kit().run(['ci', 'rerun', 'acme/web', '--run', '7'], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.refused, [...result.stdout, ...result.stderr].join('\n'));
    assert.match(result.stdout.join('\n'), /run 7 of acme\/web \(release\.yml, push, attempt 1\) ended success: .*nothing was re-run/u);
    assert.deepEqual(reruns(gh), []);
  });

  it("fails with the host's reason when the run is not there", async () => {
    const gh = new FakeGh();
    const result = await kit().run(['ci', 'rerun', 'acme/web', '--run', '7'], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.failed);
    assert.match(result.stderr.join('\n'), /^FAILED acme\/web run 7: run 7 of acme\/web is not there for the token saved as /u);
    assert.deepEqual(reruns(gh), []);
  });

  it("fails with the host's reason when GitHub refuses the re-run", async () => {
    const gh = new FakeGh().holdsRun(7, 'completed', 'failure').failsWrite({ end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'HTTP 403: Resource not accessible by personal access token\n' });
    const result = await kit().run(['ci', 'rerun', 'acme/web', '--run', '7'], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.failed);
    assert.match(result.stderr.join('\n'), /^FAILED acme\/web run 7: the token saved as .* may not re-run run 7 of acme\/web/u);
  });

  it('writes nothing, after an OFF line, while GitHub is off on this machine', async () => {
    const gh = new FakeGh();
    const result = await kit().run(['ci', 'rerun', 'acme/web', '--run', '7'], { env: { TEAMRIG_SESSION: 'alpha', TEAMRIG_GITHUB: 'off' }, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.match(result.stdout.join('\n'), /^OFF TEAMRIG_GITHUB=off turns GitHub off on this machine; nothing was written/u);
    assert.deepEqual(gh.ran, []);
  });

  const refusals: readonly { readonly name: string; readonly args: readonly string[]; readonly session: string; readonly reason: RegExp }[] = [
    { name: 'the repository is not the team’s', args: ['ci', 'rerun', 'acme/api', '--run', '7'], session: 'alpha', reason: /acme\/api is not one of the team's repositories: list it under github.repos/u },
    { name: 'the caller is not on the team', args: ['ci', 'rerun', 'acme/web', '--run', '7'], session: 'stranger', reason: /stranger/u },
    { name: 'the run id has a leading zero', args: ['ci', 'rerun', 'acme/web', '--run', '07'], session: 'alpha', reason: /--run 07 is no run id/u },
    { name: 'the run id is a path', args: ['ci', 'rerun', 'acme/web', '--run', '7/rerun-failed-jobs'], session: 'alpha', reason: /is no run id/u },
  ];

  for (const refusal of refusals) {
    it(`refuses, writing nothing, when ${refusal.name}`, async () => {
      const gh = new FakeGh();
      const result = await kit().run([...refusal.args], { env: { TEAMRIG_SESSION: refusal.session }, gh });
      assert.equal(result.code, EXIT.refused, [...result.stdout, ...result.stderr].join('\n'));
      assert.match(result.stdout.join('\n'), refusal.reason);
      assert.deepEqual(gh.ran, []);
    });
  }
});
