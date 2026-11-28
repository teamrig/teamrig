import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { KIT_VERSION } from '../../core/version.ts';
import { kitVersionsFolder } from '../../kit/kit-versions.ts';
import { restoreLogPath } from '../../restore/registry.ts';
import { CLI_PID, CliHarness, KIT, type RunOptions } from '../../testing/cli-harness.ts';
import { FakeSessionProcesses } from '../../testing/fake-session-processes.ts';
import { seedKitHome } from '../../testing/kit-home.ts';
import { EXIT } from '../runtime.ts';

/** A host's plugin cache: this client runs from `<cache>/<version>`, so `<cache>` is the second root a version runs from. */
const CACHE = '/opt/plugins/cache/teamrig';
const SELF = { node: 'node', script: `${CACHE}/${KIT_VERSION}/dist/cli/main.js`, execArgv: [] };
const OLD = '0.1.0';
const NEWER = '999.0.0';

function entry(root: string, version: string): string {
  return `node ${root}/${version}/dist/cli/main.js`;
}

/**
 * An old kit-home watcher 100, an old plugin-cache UI 200 with its UI child 201, a newer version's watcher 300, the
 * current version's watcher 400 and this sweep.
 */
function host(): FakeSessionProcesses {
  return new FakeSessionProcesses()
    .add({ pid: 100, parentPid: 1, name: 'node', commandLine: `${entry(kitVersionsFolder(KIT), OLD)} events --json` })
    .add({ pid: 200, parentPid: 1, name: 'node', commandLine: `${entry(CACHE, OLD)} ui` })
    .add({ pid: 201, parentPid: 200, name: 'node', commandLine: `node ${KIT}/ui/0.80.0/ui/main.js` })
    .add({ pid: 300, parentPid: 1, name: 'node', commandLine: `${entry(CACHE, NEWER)} events --json` })
    .add({ pid: 400, parentPid: 1, name: 'node', commandLine: `${entry(CACHE, KIT_VERSION)} events --json` })
    .add({ pid: CLI_PID, parentPid: 1, name: 'node', commandLine: `${entry(CACHE, KIT_VERSION)} kit sweep --yes` });
}

describe('teamrig kit sweep', () => {
  let kit: CliHarness;
  let processes: FakeSessionProcesses;
  let options: RunOptions;

  beforeEach(async () => {
    kit = new CliHarness();
    processes = host();
    options = { sessionProcesses: processes, self: SELF, platform: 'linux' };
    await seedKitHome(kit.files, KIT, KIT_VERSION);
  });

  it('names what an older version left running, with its tree, and ends nothing without --yes', async () => {
    const result = await kit.run(['kit', 'sweep'], options);
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.deepEqual(result.stdout, [
      'PREVIEW nothing ended (add --yes to end them): 2 left by an older version',
      `PREVIEW end old events 100 (${OLD}), tree 100`,
      `PREVIEW end old ui 200 (${OLD}), tree 200 201`,
    ]);
    assert.deepEqual(processes.ends, []);
    assert.equal(await kit.files.read(restoreLogPath(KIT)), undefined);
  });

  it('with --yes ends each old tree, never a newer or the current version, and logs each end', async () => {
    const result = await kit.run(['kit', 'sweep', '--yes'], options);
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.deepEqual(result.stdout, [`ENDED old events 100 (${OLD}), tree 100`, `ENDED old ui 200 (${OLD}), tree 200 201`]);
    assert.deepEqual(
      processes.ends.map((end) => end.pid),
      [100, 200, 201],
    );
    const at = new Date(kit.clock.now()).toISOString();
    assert.equal(
      await kit.files.read(restoreLogPath(KIT)),
      `${at} kit: ended old events 100 (${OLD}), tree 100\n${at} kit: ended old ui 200 (${OLD}), tree 200 201\n`,
    );
  });

  it('fails and logs the reason when a process will not end', async () => {
    processes.failEnd(100, 'access denied');
    const result = await kit.run(['kit', 'sweep', '--yes'], options);
    assert.equal(result.code, EXIT.failed);
    assert.equal(result.stdout[0], `FAILED could not end old events 100 (${OLD}), tree 100: 100: access denied`);
    assert.match((await kit.files.read(restoreLogPath(KIT))) ?? '', /kit: could not end old events 100 \(0\.1\.0\), tree 100: 100: access denied\n/u);
  });

  it('ends nothing when this teamrig is not the version the kit home names current', async () => {
    await seedKitHome(kit.files, KIT, NEWER);
    const result = await kit.run(['kit', 'sweep', '--yes'], options);
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(result.stdout, [`NOTE nothing ended: this teamrig is ${KIT_VERSION} and current is ${NEWER}; only the current version ends an older one's`]);
    assert.deepEqual(processes.ends, []);
  });

  it('fails when the system will not list its processes', async () => {
    processes.hideListing();
    const result = await kit.run(['kit', 'sweep', '--yes'], options);
    assert.equal(result.code, EXIT.failed);
    assert.deepEqual(result.stdout, ['FAILED nothing ended: the system would not list its processes']);
  });

  it('says so when no older version runs anything', async () => {
    const result = await kit.run(['kit', 'sweep', '--yes'], { ...options, sessionProcesses: new FakeSessionProcesses() });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(result.stdout, ['UNCHANGED no older version runs a watcher or ui']);
  });
});
