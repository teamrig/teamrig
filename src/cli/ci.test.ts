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

  it('re-runs every job of the named run of a team repository, with its saved key', async () => {
    const gh = new FakeGh();
    const result = await kit().run(['ci', 'rerun', 'Acme/Web', '--run', '45027704561'], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, ['RERUN acme/web run 45027704561: every job started again']);
    assert.deepEqual(reruns(gh), [['api', 'repos/acme/web/actions/runs/45027704561/rerun', '-X', 'POST']]);
  });

  it("fails with the host's reason when GitHub refuses the re-run", async () => {
    const gh = new FakeGh().failsWrite({ end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'HTTP 404: Not Found\n' });
    const result = await kit().run(['ci', 'rerun', 'acme/web', '--run', '7'], { ...AS_ALPHA, gh });
    assert.equal(result.code, EXIT.failed);
    assert.match(result.stderr.join('\n'), /^FAILED acme\/web run 7: run 7 of acme\/web is not there for the token saved as /u);
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
