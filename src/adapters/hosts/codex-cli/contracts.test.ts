import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bind, CONTRACTS, LAUNCHER_CONTRACT, USAGE_CONTRACT, type LauncherWorld, type UsageWorld } from '../../../conformance/index.ts';
import type { HostDeclaration } from '../../../plugin-api/index.ts';
import { describeContracts, suiteOf, type ContractsOf } from '../../../testing/contracts.ts';
import { SUPPORTED } from '../../../testing/manifests.ts';
import { declaration } from './declaration.ts';
import { sessionLauncher } from './session-launcher.ts';
import { AGENT_MARK } from './session-variables.ts';
import { usageMeter } from './usage.ts';

/** A Codex CLI conversation id, as `CODEX_THREAD_ID` and `codex resume` carry it. */
const SESSION = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b';

/**
 * Codex CLI hands no status input with rate windows (its week is read from the rollouts), so every window the case
 * names is left out of what it hands.
 */
const usageWorld: UsageWorld = { status: () => '{}' };

/**
 * Codex CLI's environment for a run: only the session's id, under its mark. It tells no start folder, start word,
 * kind or forced effort, so a case telling those gets nothing for them.
 */
const launcherWorld: LauncherWorld = {
  env: ({ sessionId }) => (sessionId === undefined ? {} : { [AGENT_MARK]: sessionId }),
  sessionProcess: { name: 'codex.exe', commandLine: `codex resume ${SESSION}` },
  forkOf: (session) => `codex fork ${session}`,
  backgroundJob: () => [{ name: 'codex.exe', commandLine: 'codex' }],
  places: { tab: {}, background: {}, elsewhere: {} },
};

/** What Codex CLI tells of a run: its session's id under its mark, and nothing else (`sessions.identity` is partial). */
const ONLY_THE_ID = "Codex CLI tells only the session's id, by its mark: no start folder, start word, kind or forced effort";

/**
 * The ports Codex CLI has built, each bound to its contract, so a manifest row turned on runs its cases. A launcher
 * case for what Codex does not tell is left out, its row partial and naming what is missing.
 */
const BOUND = [
  bind({ contract: USAGE_CONTRACT, make: () => ({ port: usageMeter, world: usageWorld }) }),
  bind({
    contract: LAUNCHER_CONTRACT,
    make: () => ({ port: sessionLauncher, world: launcherWorld }),
    without: {
      'launcher.tells-identity': ONLY_THE_ID,
      'launcher.blank-tells-nothing': ONLY_THE_ID,
      'launcher.names-variables': 'the mark CODEX_THREAD_ID is the only variable Codex CLI tells a run by; it names no identity variable',
      'launcher.session-place': 'Codex CLI tells nothing of where a run started, so no place is read',
      'launcher.reads-background-job': 'Codex CLI starts a background job with no session on its command line',
    },
  }),
];

describeContracts({ side: 'host', declaration, bound: BOUND });

/** Codex CLI's declaration with these rows claimed, every other row as it ships. */
function claiming(...features: readonly (keyof HostDeclaration['manifest'])[]): ContractsOf {
  const manifest = { ...declaration.manifest, ...Object.fromEntries(features.map((feature) => [feature, SUPPORTED])) };
  return { side: 'host', declaration: { ...declaration, manifest }, bound: BOUND };
}

describe('Codex CLI as it ships', () => {
  const suite = suiteOf({ side: 'host', declaration, bound: BOUND }, { os: 'windows', kit: CONTRACTS });

  it('runs the usage cases and the launcher cases of what it tells, with nothing its bindings break (T5559)', () => {
    assert.deepEqual(suite.problems, []);
    const [usage, launcher] = suite.groups;
    assert.deepEqual(
      suite.groups.map((group) => group.port),
      ['usage', 'launcher'],
    );
    assert.ok(usage !== undefined && usage.cases.length > 0);
    assert.deepEqual(
      launcher?.cases.map((one) => one.id),
      ['launcher.session-process', 'launcher.reads-fork'],
    );
  });

  it('may not leave a launcher case out once its row is claimed supported', () => {
    const problems = suiteOf(claiming('sessions.identity', 'sessions.process'), { os: 'windows', kit: CONTRACTS }).problems;
    assert.deepEqual(
      problems.filter((problem) => problem.includes('cannot be left out')),
      [
        'launcher.tells-identity cannot be left out: the manifest says sessions.identity is supported',
        'launcher.blank-tells-nothing cannot be left out: the manifest says sessions.identity is supported',
        'launcher.names-variables cannot be left out: the manifest says sessions.identity is supported',
        'launcher.session-place cannot be left out: the manifest says sessions.identity is supported',
        'launcher.reads-background-job cannot be left out: the manifest says sessions.process is supported',
      ],
    );
  });
});

describe('Codex CLI with a row claimed that no bound port holds', () => {
  it('fails the claim, so turning a row on needs its port bound first', () => {
    const suite = suiteOf({ ...claiming('budget.usage'), bound: [] }, { os: 'windows', kit: CONTRACTS });
    assert.notDeepEqual(suite.problems, []);
  });
});
