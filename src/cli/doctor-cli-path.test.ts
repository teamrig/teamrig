import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cliLauncherFolder } from '../restore/cli-launcher.ts';
import { CliHarness, KIT, TEAM } from '../testing/cli-harness.ts';
import { FakeUserPath, quietRestore } from '../testing/fake-restore.ts';

const FOLDER = cliLauncherFolder(KIT);

/** The harness's team with `cliOnPath.enabled` set to `enabled`, its secret deny lines held so only this check speaks. */
async function teamWith(enabled: boolean): Promise<CliHarness> {
  const kit = new CliHarness({ ...TEAM, cliOnPath: { enabled } });
  await kit.holdSecretDeny();
  return kit;
}

describe('teamrig doctor: teamrig on the user PATH (T5095)', () => {
  it("flags the kit home's bin folder missing from the user's PATH, reading where the PATH is kept", async () => {
    const userPath = new FakeUserPath();
    const { stdout } = await (await teamWith(true)).run(['doctor'], { restore: { ...quietRestore(), userPath } });
    assert.deepEqual(stdout, [
      'DOCTOR 1 finding(s), team app',
      `WARN cli-path ${FOLDER} is not on the user's PATH (${userPath.where}), so \`teamrig\` is not found in a terminal you open: the next session start of the team adds it (cliOnPath.enabled); start one, then open a new terminal`,
    ]);
    assert.deepEqual(userPath.folders, []);
  });

  it('names the switch as the fix when cliOnPath.enabled is off', async () => {
    const { stdout } = await (await teamWith(false)).run(['doctor'], { restore: { ...quietRestore(), userPath: new FakeUserPath() } });
    assert.match(stdout[1] ?? '', /^WARN cli-path .*: cliOnPath\.enabled is false, so no session start adds it: set it to true/);
  });

  it('stays clean when the folder is on the PATH', async () => {
    const restore = { ...quietRestore(), userPath: new FakeUserPath([FOLDER]) };
    assert.deepEqual((await (await teamWith(false)).run(['doctor'], { restore })).stdout, ['DOCTOR clean, team app']);
  });
});
