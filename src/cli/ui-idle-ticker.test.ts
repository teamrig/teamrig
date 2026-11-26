import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Files } from '../core/files.ts';
import type { JsonRecord } from '../core/guards.ts';
import { SessionLog } from '../sessions/log.ts';
import { SessionRecordStore } from '../sessions/record.ts';
import { APP, CliHarness, KIT, TEAM, TEAM_HOME } from '../testing/cli-harness.ts';
import { FakeHostMemory } from '../testing/fake-host-memory.ts';
import { FakePathProbe, FakeProcesses } from '../testing/fake-processes.ts';
import { FaultyFiles, systemError } from '../testing/faulty-files.ts';
import { IDLE_PASS_EVERY_MS, TREE_PASS_AFTER_MS } from './idle-pass-log.ts';
import type { CliRuntime } from './runtime.ts';
import { runUiIdlePasses, startUiIdleTicker, uiIdlePassPath, type UiIdleTicker, type UiPassTick } from './ui-idle-ticker.ts';

const STATE = join(TEAM_HOME, 'state');
const SESSION_LOG = join(STATE, 'session-log.jsonl');
const COMMIT = { usedMb: 85_300, limitMb: 100_700 };
const MINUTE = 60 * 1000;

/** A team in `mode` whose bravo the lead closed at 09:00 UTC in the app folder, with a p1 handed to it since. */
async function teamWithClosedBravo(mode: 'on' | 'dry-run'): Promise<CliHarness> {
  const kit = new CliHarness({ ...TEAM, open: { idle: { mode } } });
  await new SessionLog(kit.files, SESSION_LOG).append({ kind: 'close', session: 'bravo', by: 'lead', at: '2030-01-08T09:00:00.000Z', hostSession: 'claude-bravo', idleMinutes: 75, freedMb: 1300, folder: APP });
  const handed = await kit.run(['add', '--title', 'Ship the page', '--description', 'what and why', '--priority', 'p1', '--owner', 'bravo', '--session', 'lead']);
  assert.equal(handed.code, 0, handed.stderr.join('\n'));
  return kit;
}

/** Alpha's record, running in Codex CLI: a host with no tab mod to run its wake check. */
async function hostAlpha(kit: CliHarness): Promise<void> {
  await new SessionRecordStore(kit.files, { sessions: join(STATE, 'sessions') }).write('alpha', { claudePid: 4242, hostSession: 'thread-1', at: new Date(kit.clock.now()).toISOString(), host: 'codex' });
}

function runtimeOf(kit: CliHarness, { processes = new FakeProcesses(), files = kit.files, stderr = [] }: { readonly processes?: FakeProcesses; readonly files?: Files; readonly stderr?: string[] } = {}): CliRuntime {
  const out = { stdout: () => undefined, stderr: (line: string) => stderr.push(line) };
  return kit.runtime({ processes, files, probe: new FakePathProbe({ folders: [APP] }), memory: new FakeHostMemory().lists([], COMMIT) }, out);
}

describe('the idle passes the UI runs (T5634)', () => {
  it("runs a team's pass at once, then only after its own tabs left it unrun for 5 minutes when no session of it is hosted", async () => {
    const kit = await teamWithClosedBravo('dry-run');
    assert.deepEqual((await runUiIdlePasses(runtimeOf(kit))).teams, ['app'], 'a pass that never ran is due');
    kit.clock.advance(TREE_PASS_AFTER_MS - MINUTE);
    assert.deepEqual((await runUiIdlePasses(runtimeOf(kit))).teams, [], "the team's own tabs still run it");
    kit.clock.advance(MINUTE);
    assert.deepEqual((await runUiIdlePasses(runtimeOf(kit))).teams, ['app']);
  });

  it('runs each minute the pass of a team with a session in a host with no wake check, as its tab would', async () => {
    const kit = await teamWithClosedBravo('dry-run');
    await hostAlpha(kit);
    assert.deepEqual((await runUiIdlePasses(runtimeOf(kit))).teams, ['app']);
    kit.clock.advance(IDLE_PASS_EVERY_MS - 1);
    assert.deepEqual((await runUiIdlePasses(runtimeOf(kit))).teams, [], 'the pass runs at most once a minute');
    kit.clock.advance(1);
    assert.deepEqual((await runUiIdlePasses(runtimeOf(kit))).teams, ['app']);
  });

  it('reopens a closed session handed work, in the folder its close logged', async () => {
    const kit = await teamWithClosedBravo('on');
    await hostAlpha(kit);
    const processes = new FakeProcesses();
    await runUiIdlePasses(runtimeOf(kit, { processes }));
    assert.deepEqual(
      processes.hidden.map(({ args, cwd }): JsonRecord => ({ args: args.slice(1), cwd })),
      [{ args: ['idle-open', 'bravo', '--team', 'app', '--project', APP], cwd: APP }],
    );
  });

  it("warns of a team's failed pass on the runtime's stderr, counting it as no pass run", async () => {
    const kit = await teamWithClosedBravo('dry-run');
    const files = new FaultyFiles(kit.files).fail('read', SESSION_LOG, systemError('EACCES', 'EACCES: permission denied'));
    const stderr: string[] = [];
    assert.deepEqual(await runUiIdlePasses(runtimeOf(kit, { files, stderr })), { teams: [], problems: [] });
    assert.deepEqual(stderr, ['WARN the idle pass of team app, run from the UI, failed: EACCES: permission denied; the next pass tries again']);
  });
});

/** A sleep each call of which waits until the spec lets it go, recording how long it was asked to wait. */
class HeldSleep {
  readonly asked: number[] = [];
  private readonly waiting: (() => void)[] = [];

  readonly sleep = (ms: number): Promise<void> => {
    this.asked.push(ms);
    return new Promise((resolve) => this.waiting.push(resolve));
  };

  /** Lets the oldest waiting sleep end, then lets the loop run up to its next wait. */
  async release(): Promise<void> {
    this.waiting.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('the UI idle ticker (T5634)', () => {
  const PATH = uiIdlePassPath(KIT);
  const tickOf = (kit: CliHarness): unknown => JSON.parse(kit.files.get(PATH) ?? 'null');

  it('waits a minute before each tick, writes each over the last, and a tick that throws neither kills it nor prints', async () => {
    const kit = new CliHarness(TEAM);
    const held = new HeldSleep();
    const printed: string[] = [];
    const runtime = kit.runtime({ idleSleep: held.sleep }, { stdout: (line) => printed.push(line), stderr: (line) => printed.push(line) });
    const ticks: (() => UiPassTick)[] = [
      () => {
        throw new Error('the tree did not load');
      },
      () => ({ teams: ['app'], problems: ['WARN one'] }),
    ];
    const ticker = startUiIdleTicker(runtime, async (passRuntime) => {
      passRuntime.out.stderr('WARN kept off the terminal');
      return (ticks.shift() ?? (() => ({ teams: [], problems: [] })))();
    });
    assert.deepEqual([held.asked, kit.files.get(PATH)], [[IDLE_PASS_EVERY_MS], undefined], 'no tick before the first wait ends');
    const at = new Date(kit.clock.now()).toISOString();
    await held.release();
    assert.deepEqual(tickOf(kit), { v: 1, at, teams: [], problems: ['WARN kept off the terminal', 'the tree did not load'] });
    await held.release();
    assert.deepEqual(tickOf(kit), { v: 1, at, teams: ['app'], problems: ['WARN kept off the terminal', 'WARN one'] });
    assert.deepEqual([held.asked.length, printed], [3, []]);
    ticker.stop();
    await held.release();
    await ticker.ended;
    assert.equal(held.asked.length, 3, 'a ticker stopped during its wait runs no tick after it');
  });

  it('runs no tick once stopped before its first wait ends', async () => {
    const kit = new CliHarness(TEAM);
    const held = new HeldSleep();
    let runs = 0;
    const ticker: UiIdleTicker = startUiIdleTicker(kit.runtime({ idleSleep: held.sleep }), async () => {
      runs += 1;
      return { teams: [], problems: [] };
    });
    ticker.stop();
    await held.release();
    await ticker.ended;
    assert.deepEqual([runs, kit.files.get(PATH)], [0, undefined]);
  });
});
