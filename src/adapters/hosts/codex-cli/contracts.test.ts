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

/** The ports Codex CLI has built, each bound to its contract, so a manifest row turned on runs its cases. */
const BOUND = [
  bind({ contract: USAGE_CONTRACT, make: () => ({ port: usageMeter, world: usageWorld }) }),
  bind({ contract: LAUNCHER_CONTRACT, make: () => ({ port: sessionLauncher, world: launcherWorld }) }),
];

describeContracts({ side: 'host', declaration, bound: BOUND });

/** Codex CLI's declaration with these rows claimed, every other row as it ships. */
function claiming(...features: readonly (keyof HostDeclaration['manifest'])[]): ContractsOf {
  const manifest = { ...declaration.manifest, ...Object.fromEntries(features.map((feature) => [feature, SUPPORTED])) };
  return { side: 'host', declaration: { ...declaration, manifest }, bound: BOUND };
}

describe('Codex CLI with the rows its built usage meter holds claimed', () => {
  const suite = suiteOf(claiming('budget.usage', 'context.size'), { os: 'windows', kit: CONTRACTS });

  it('runs the usage cases, with nothing its bindings break', () => {
    assert.deepEqual(suite.problems, []);
    assert.deepEqual(
      suite.groups.map((group) => group.port),
      ['usage'],
    );
    assert.ok(suite.groups[0] !== undefined && suite.groups[0].cases.length > 0);
  });

  for (const group of suite.groups) {
    for (const one of group.cases) {
      it(`${group.port}: ${one.title}`, one.run);
    }
  }
});

describe('Codex CLI with a row claimed that no bound port holds', () => {
  it('fails the claim, so turning a row on needs its port bound first', () => {
    const suite = suiteOf({ ...claiming('budget.usage'), bound: [] }, { os: 'windows', kit: CONTRACTS });
    assert.notDeepEqual(suite.problems, []);
  });
});
