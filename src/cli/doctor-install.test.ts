import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import type { PathKind } from '../core/path-probe.ts';
import { PROBE_TIMEOUT_MS } from '../install/steps.ts';
import { MIN_NODE, versionText } from '../requirements/requirements.ts';
import { CliHarness, CONFIG_PATH, TEAM, type CliResult, type RunOptions } from '../testing/cli-harness.ts';
import { probeOf } from '../testing/fake-checkout.ts';
import { EXIT } from './runtime.ts';

/** The quiet host runs the CLI from /opt/teamrig/dist/cli/main.js, so its shim is /opt/teamrig/bin/teamrig. */
const SHIM = '/opt/teamrig/bin/teamrig';
const INSTALLED: RunOptions = { env: { PATH: '/usr/bin:/opt/teamrig/bin' }, probe: probeOf(SHIM) };
const NODE = `Node.js ${versionText(MIN_NODE)} or later`;

/** The INSTALL section doctor prints, from its header on. */
function installOf(result: CliResult): string[] {
  const header = result.stdout.findIndex((line) => line.startsWith('INSTALL '));
  assert.notEqual(header, -1, `no INSTALL section in ${result.stdout.join(' | ')}`);
  return result.stdout.slice(header);
}

describe('teamrig doctor: the install check (T5075)', () => {
  it('prints every shared install step after the findings, each OK on a working install', async () => {
    const kit = new CliHarness(TEAM);
    const result = await kit.run(['doctor'], INSTALLED);
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout[0] ?? '', /^DOCTOR /);
    assert.deepEqual(installOf(result), [
      'INSTALL 4 step(s): 4 ok, 0 missing, 0 unknown',
      `  OK node (${NODE}): ${NODE} runs teamrig`,
      '  OK git (git on PATH): git is on PATH',
      `  OK cli (the teamrig command on PATH): ${SHIM}`,
      `  OK team (a team whose config loads): team app, config ${CONFIG_PATH}`,
    ]);
  });

  it('names a step that is missing with its fix, and still probes the rest', async () => {
    const kit = new CliHarness(TEAM);
    const lines = installOf(await kit.run(['doctor'], { env: { PATH: '/usr/bin' } }));
    assert.equal(lines[0], 'INSTALL 4 step(s): 3 ok, 1 missing, 0 unknown');
    assert.equal(lines[3], '  MISSING cli (the teamrig command on PATH): no teamrig on PATH; fix: start a new session of a host with the teamrig plugin enabled, or add /opt/teamrig/bin to PATH');
  });

  it('shows a probe that hangs past its limit as unknown, without holding back the other steps', async () => {
    const kit = new CliHarness(TEAM);
    // Only the shim's look hangs: doctor's findings probe other paths and must still finish.
    const hangsOnShim = {
      kind: (path: string): Promise<PathKind> => (win32.normalize(path) === win32.normalize(SHIM) ? new Promise<never>(() => undefined) : Promise.resolve('none')),
    };
    const lines = installOf(await kit.run(['doctor'], { ...INSTALLED, probe: hangsOnShim, idleSleep: async () => undefined }));
    assert.deepEqual(lines, [
      'INSTALL 4 step(s): 3 ok, 0 missing, 1 unknown',
      `  OK node (${NODE}): ${NODE} runs teamrig`,
      '  OK git (git on PATH): git is on PATH',
      `  UNKNOWN cli (the teamrig command on PATH): the probe ran past ${PROBE_TIMEOUT_MS} ms`,
      `  OK team (a team whose config loads): team app, config ${CONFIG_PATH}`,
    ]);
  });

  it('with no team found, prints the install check with the create line as the fix, then refuses as before', async () => {
    const kit = new CliHarness(TEAM, null);
    const result = await kit.run(['doctor'], INSTALLED);
    assert.equal(result.code, EXIT.refused);
    const lines = installOf(result);
    assert.equal(lines[0], 'INSTALL 4 step(s): 3 ok, 1 missing, 0 unknown');
    assert.match(lines[4] ?? '', /^ {2}MISSING team \(a team whose config loads\): no team found from here; fix: no team here: create one with teamrig team create <team> --sessions <id,id>, /);
    assert.match(lines[5] ?? '', /^REFUSED no team here: /);
  });
});
