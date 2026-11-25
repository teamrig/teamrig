import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Files } from '../core/files.ts';
import type { ProgramRequest } from '../core/program-runner.ts';
import type { WakeDelivery } from '../ports/host/index.ts';
import { SessionRecordStore } from '../sessions/record.ts';
import { CliHarness, TEAM, TEAM_HOME } from '../testing/cli-harness.ts';
import { FaultyFiles, systemError } from '../testing/faulty-files.ts';
import { FakePathProbe } from '../testing/fake-processes.ts';
import { FakeSessionProcesses } from '../testing/fake-session-processes.ts';
import { recordingRunner, WAKING_HOST, WAKING_PROGRAM, wakingHosts } from '../testing/waking-host.ts';
import { WakeAsks } from '../wake/asks.ts';
import { wakeHostedSessions } from './hosted-wake.ts';
import { openKit, rosterOf } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

const CODEX_PID = 4100;
const THREAD = '0199aaaa-0000-7000-8000-0000000000c3';
const SESSIONS = join(TEAM_HOME, 'state', 'sessions');
const ASKS = join(TEAM_HOME, 'state', 'wake-asks');

interface Hosted {
  readonly kit: CliHarness;
  readonly runs: ProgramRequest[];
  /** The WARN lines a call for alpha gives, reading through `files` when given. */
  readonly warnings: (files?: Files) => Promise<readonly string[]>;
}

/** A team whose alpha runs in `host` (no record when undefined) with an urgent line a batch old, its wakes answered with `delivery`. */
async function teamWithAlpha(host: string | undefined, delivery?: WakeDelivery): Promise<Hosted> {
  const kit = new CliHarness(TEAM);
  const runs: ProgramRequest[] = [];
  const processes = new FakeSessionProcesses();
  processes.add({ pid: CODEX_PID, parentPid: 1, name: 'codex.exe', commandLine: 'codex' });
  if (host !== undefined) {
    await new SessionRecordStore(kit.files, { sessions: SESSIONS }).write('alpha', { claudePid: CODEX_PID, hostSession: THREAD, at: new Date(kit.clock.now()).toISOString(), host });
  }
  const runtime = (files?: Files): CliRuntime =>
    kit.runtime({
      shippedHosts: wakingHosts(delivery),
      platform: 'linux',
      env: { PATH: '/bin' },
      probe: new FakePathProbe({ files: [WAKING_PROGRAM] }),
      sessionProcesses: processes,
      program: recordingRunner(runs),
      ...(files === undefined ? {} : { files }),
    });
  const warnings = async (files?: Files): Promise<readonly string[]> => {
    const kitOf = await openKit(runtime(), 'app');
    if (kitOf.load.status !== 'loaded') {
      throw new Error(`the team did not load: ${kitOf.load.status}`);
    }
    const { config } = kitOf.load;
    return wakeHostedSessions(runtime(files), kitOf, config, await rosterOf(runtime(), kitOf, config), ['alpha']);
  };
  // The first check takes what is there; the urgent line posted after it is due once it is a batch old.
  await warnings();
  await new WakeAsks(kit.files, ASKS).post('alpha', { from: 'lead', text: 'the api is ready', at: kit.clock.now() });
  kit.clock.advance(120 * 1000);
  return { kit, runs, warnings };
}

describe('wakeHostedSessions (T5059)', () => {
  it('runs no wake for a session with no host in its record', async () => {
    const { runs, warnings } = await teamWithAlpha(undefined);
    assert.deepEqual(await warnings(), []);
    assert.deepEqual(runs, []);
  });

  it('wakes a hosted session and warns of none, and warns of a wake its host failed with why', async () => {
    const woken = await teamWithAlpha(WAKING_HOST);
    assert.deepEqual(await woken.warnings(), []);
    assert.equal(woken.runs.length, 1);
    const failed = await teamWithAlpha(WAKING_HOST, { kind: 'failed', reason: 'codex queue exited 2' });
    assert.deepEqual(await failed.warnings(), ['WARN teamrig could not wake alpha through its host: codex queue exited 2']);
  });

  it('warns, never throws, when the session records cannot be read', async () => {
    const { kit, warnings } = await teamWithAlpha(WAKING_HOST);
    const faulty = new FaultyFiles(kit.files).fail('read', join(SESSIONS, 'alpha.json'), systemError('EACCES', 'EACCES: permission denied'));
    assert.deepEqual(await warnings(faulty), ['WARN teamrig could not wake alpha through their host: EACCES: permission denied']);
  });
});
