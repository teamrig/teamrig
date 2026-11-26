import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_HOST } from '../composition/adapters.ts';
import type { ProgramRequest, ProgramRunner } from '../core/program-runner.ts';
import type { WakeDelivery } from '../ports/host/index.ts';
import { SessionRecordStore, type SessionRecord } from '../sessions/record.ts';
import { CliHarness, TEAM, TEAM_HOME } from '../testing/cli-harness.ts';
import { FakePathProbe } from '../testing/fake-processes.ts';
import { FakeSessionProcesses } from '../testing/fake-session-processes.ts';
import { LOCK_HOLDER } from '../testing/held-file-lock.ts';
import { failingRunner, recordingRunner, WAKING_HOST, WAKING_PROGRAM, wakingHosts } from '../testing/waking-host.ts';
import { WakeAsks } from '../wake/asks.ts';
import { wakeHostSessions, type HostWakeResult } from './host-wake.ts';
import { openKit, rosterOf } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

const SECOND = 1000;
const CODEX_PID = 4100;
const THREAD = '0199aaaa-0000-7000-8000-0000000000c1';
const ASKS = join(TEAM_HOME, 'state', 'wake-asks');
const WAKE_LOG = join(TEAM_HOME, 'state', 'wakes.jsonl');
const SESSIONS = join(TEAM_HOME, 'state', 'sessions');
const ALPHA_WAKE_LOCK = join(TEAM_HOME, 'state', 'wake', 'alpha.lock');
interface Wakes {
  readonly kit: CliHarness;
  readonly runs: ProgramRequest[];
  readonly processes: FakeSessionProcesses;
  readonly wake: () => Promise<readonly HostWakeResult[]>;
}

interface CodexAlpha {
  readonly delivery?: WakeDelivery;
  readonly host?: string;
  readonly dead?: boolean;
  readonly config?: object;
  /** False when the host's program is not on PATH. */
  readonly onPath?: boolean;
  /** The runner each wake runs through, in place of one that records it in `runs`. */
  readonly runner?: ProgramRunner;
}

/** A team whose alpha runs in `host` (`codex-cli` unless told) as process CODEX_PID, alive unless `dead`, with an urgent line a batch old. */
async function teamWithCodexAlpha(options: CodexAlpha = {}): Promise<Wakes> {
  const kit = new CliHarness({ ...TEAM, ...options.config });
  const runs: ProgramRequest[] = [];
  const processes = new FakeSessionProcesses();
  if (options.dead !== true) {
    processes.add({ pid: CODEX_PID, parentPid: 1, name: 'codex.exe', commandLine: 'codex' });
  }
  const record: SessionRecord = { claudePid: CODEX_PID, hostSession: THREAD, at: new Date(kit.clock.now()).toISOString(), host: options.host ?? WAKING_HOST };
  await new SessionRecordStore(kit.files, { sessions: SESSIONS }).write('alpha', record);
  const runtime = (): CliRuntime =>
    kit.runtime({
      shippedHosts: wakingHosts(options.delivery),
      platform: 'linux',
      env: { PATH: '/bin' },
      probe: new FakePathProbe({ files: options.onPath === false ? [] : [WAKING_PROGRAM] }),
      sessionProcesses: processes,
      program: options.runner ?? recordingRunner(runs),
    });
  const wake = async (): Promise<readonly HostWakeResult[]> => {
    const kitOf = await openKit(runtime(), 'app');
    assert.equal(kitOf.load.status, 'loaded');
    if (kitOf.load.status !== 'loaded') {
      return [];
    }
    const { config } = kitOf.load;
    return wakeHostSessions(runtime(), kitOf, config, await rosterOf(runtime(), kitOf, config));
  };
  // The first check takes what is there; the urgent line posted after it is due once it is a batch old.
  await wake();
  await new WakeAsks(kit.files, ASKS).post('alpha', { from: 'lead', text: 'the api is ready', at: kit.clock.now() });
  kit.clock.advance(120 * SECOND);
  return { kit, runs, processes, wake };
}

async function droppedLines(kit: CliHarness): Promise<unknown[]> {
  return ((await kit.files.read(WAKE_LOG)) ?? '')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line))
    .filter((line) => typeof line === 'object' && line !== null && 'kind' in line && line.kind === 'dropped');
}

describe('wakeHostSessions (T5059)', () => {
  it("hands a running Codex session its wake prompt through the host's program, found on PATH", async () => {
    const { kit, runs, wake } = await teamWithCodexAlpha();
    assert.deepEqual(await wake(), [{ id: 'alpha', kind: 'woken' }]);
    assert.equal(runs.length, 1);
    const [run] = runs;
    assert.equal(run?.program, WAKING_PROGRAM);
    assert.deepEqual(run?.args.slice(0, 2), ['wake', THREAD]);
    assert.match(run?.args[2] ?? '', /^Urgent lines were posted for you while this tab was idle; act on each now:\n- \d\d:\d\d \w+ lead: the api is ready\n/);
    assert.deepEqual(await droppedLines(kit), []);
    assert.deepEqual(await wake(), [{ id: 'alpha', kind: 'quiet' }], 'never twice for one line');
    assert.equal(runs.length, 1);
  });

  it('logs a wake its host runs no session for as dropped, and one that failed with why', async () => {
    const gone = await teamWithCodexAlpha({ delivery: { kind: 'no-session' } });
    assert.deepEqual(await gone.wake(), [{ id: 'alpha', kind: 'no-session' }]);
    assert.deepEqual(await droppedLines(gone.kit), [
      { v: 1, at: new Date(gone.kit.clock.now()).toISOString(), kind: 'dropped', session: 'alpha', tab: THREAD, reason: 'the host runs no session of that id' },
    ]);
    const failed = await teamWithCodexAlpha({ delivery: { kind: 'failed', reason: 'codex queue exited 2' } });
    assert.deepEqual(await failed.wake(), [{ id: 'alpha', kind: 'failed', reason: 'codex queue exited 2' }]);
    assert.deepEqual(await droppedLines(failed.kit), [
      { v: 1, at: new Date(failed.kit.clock.now()).toISOString(), kind: 'dropped', session: 'alpha', tab: THREAD, reason: 'codex queue exited 2' },
    ]);
  });

  it('fails a wake whose program is not on PATH, and one whose runner throws, logging each dropped with why', async () => {
    const missing = await teamWithCodexAlpha({ onPath: false });
    assert.deepEqual(await missing.wake(), [{ id: 'alpha', kind: 'failed', reason: 'codex is not on PATH' }]);
    assert.deepEqual(missing.runs, []);
    assert.deepEqual(await droppedLines(missing.kit), [
      { v: 1, at: new Date(missing.kit.clock.now()).toISOString(), kind: 'dropped', session: 'alpha', tab: THREAD, reason: 'codex is not on PATH' },
    ]);
    const thrown = await teamWithCodexAlpha({ runner: failingRunner('spawn codex EACCES') });
    assert.deepEqual(await thrown.wake(), [{ id: 'alpha', kind: 'failed', reason: 'spawn codex EACCES' }]);
    assert.deepEqual(await droppedLines(thrown.kit), [
      { v: 1, at: new Date(thrown.kit.clock.now()).toISOString(), kind: 'dropped', session: 'alpha', tab: THREAD, reason: 'spawn codex EACCES' },
    ]);
  });

  it("is quiet for a session another check holds the wake lock of, and wakes it once the lock is let go", async () => {
    const { kit, runs, processes, wake } = await teamWithCodexAlpha();
    processes.add(LOCK_HOLDER);
    await kit.files.write(ALPHA_WAKE_LOCK, JSON.stringify({ pid: LOCK_HOLDER.pid, at: kit.clock.now(), id: 'held' }));
    assert.deepEqual(await wake(), [{ id: 'alpha', kind: 'quiet' }]);
    assert.deepEqual(runs, []);
    await kit.files.remove(ALPHA_WAKE_LOCK);
    assert.deepEqual(await wake(), [{ id: 'alpha', kind: 'woken' }]);
  });

  it("leaves a session of the default host to its tab's mod, one of a host not shipped, and one no longer running, running nothing", async () => {
    for (const options of [{ host: DEFAULT_HOST }, { host: 'no-such-host' }, { dead: true }]) {
      const { runs, wake } = await teamWithCodexAlpha(options);
      assert.deepEqual(await wake(), [], JSON.stringify(options));
      assert.deepEqual(runs, []);
    }
  });

  it('wakes nothing with wake.enabled false', async () => {
    const { runs, wake } = await teamWithCodexAlpha({ config: { wake: { enabled: false } } });
    assert.deepEqual(await wake(), []);
    assert.deepEqual(runs, []);
  });
});
