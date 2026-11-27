import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cliLauncherFolder } from '../restore/cli-launcher.ts';
import { CliHarness, findingLines, KIT, TEAM, TEAM_HOME } from '../testing/cli-harness.ts';
import { FakeUserPath, quietRestore } from '../testing/fake-restore.ts';

const HANDOVER = join(TEAM_HOME, 'handover', 'alpha.md');

/** The harness's team with `refresh.handoverWarnBytes` at `warnBytes`, its PATH and deny lines held so only this check speaks. */
async function doctorWith(warnBytes: number, handover: string | undefined): Promise<readonly string[]> {
  const kit = new CliHarness({ ...TEAM, refresh: { handoverWarnBytes: warnBytes } });
  await kit.holdSecretDeny();
  if (handover !== undefined) {
    await kit.files.write(HANDOVER, handover);
  }
  const restore = { ...quietRestore(), userPath: new FakeUserPath([cliLauncherFolder(KIT)]) };
  return findingLines((await kit.run(['doctor'], { restore })).stdout);
}

describe('teamrig doctor: a handover past refresh.handoverWarnBytes (T2537)', () => {
  it('names the session whose handover is past the warning size, with its path, size and fix', async () => {
    assert.deepEqual(await doctorWith(100, `## State\n${'x'.repeat(200)}\n## Next steps\n`), [
      'DOCTOR 1 finding(s), team app',
      `WARN handover-long app-alpha (session alpha): ${HANDOVER} is 224 bytes, past refresh.handoverWarnBytes (100): a handover holds state only; move each how-to to a skill and a code map to a reference file it names`,
    ]);
  });

  it('stays clean with a handover under the size, with none, and with the warning off', async () => {
    assert.deepEqual(await doctorWith(10_000, '## State\n## Next steps\n'), ['DOCTOR clean, team app']);
    assert.deepEqual(await doctorWith(100, undefined), ['DOCTOR clean, team app']);
    assert.deepEqual(await doctorWith(0, 'x'.repeat(500)), ['DOCTOR clean, team app']);
  });
});
