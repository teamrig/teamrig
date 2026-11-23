import { join } from 'node:path';
import { protocolTerminal } from '../adapters/terminals/protocol/client.ts';
import { kitLeaks, kitWorld, type KitLeak } from '../adapters/terminals/protocol/kit.ts';
import { pinnedTransport, PROTOCOL_OUTPUT_CAP_BYTES, PROTOCOL_TIME_LIMIT_MS, type PinnedRunPorts, type ProgramPin } from '../adapters/terminals/protocol/spawn.ts';
import { privateStage } from '../adapters/terminals/protocol/stage.ts';
import { bind, runCases, TERMINAL_CONTRACT, type BoundCase, type CaseResult } from '../conformance/index.ts';
import { nodeProgramRunner } from '../core/program-runner.ts';
import type { Env, Os } from '../plugin-api/index.ts';

export type { KitLeak } from '../adapters/terminals/protocol/kit.ts';
export type { ProgramPin } from '../adapters/terminals/protocol/spawn.ts';

/** How the kit stages and runs a pinned terminal program: the real ones wired by the CLI, a spec's fakes. */
export type TerminalPrograms = Pick<PinnedRunPorts, 'stage' | 'run'>;

/** The real ones: copies staged under `<kitHome>/terminal-programs`, each run held to the protocol's time and output limits. */
export function nodeTerminalPrograms(kitHome: string, pid: number): TerminalPrograms {
  return {
    stage: privateStage(join(kitHome, 'terminal-programs'), String(pid)),
    run: nodeProgramRunner(PROTOCOL_TIME_LIMIT_MS, PROTOCOL_OUTPUT_CAP_BYTES),
  };
}

export interface TerminalKitRun {
  readonly pin: ProgramPin;
  /** The file's bytes, or undefined when it is not there. */
  readonly read: PinnedRunPorts['read'];
  readonly programs: TerminalPrograms;
  readonly env: Env;
  /** The operating system the run is on; undefined runs every case. */
  readonly os: Os | undefined;
  /** Unique to this run, so its kit worlds are new to a program that keeps its fakes between runs. */
  readonly runId: string;
}

export interface TerminalKitReport {
  readonly cases: readonly CaseResult[];
  /** The ids of the cases whose feature this operating system lacks. */
  readonly skipped: readonly string[];
  /** The kit requests the program served outside kit mode: a production host must serve none. */
  readonly leaks: readonly KitLeak[];
}

/**
 * Runs the terminal contract on an outside program over the protocol. The program runs once per request, so each case
 * gets a kit world of a new name (`KIT_MODE_ENV`), which the program keeps apart from every other. Last, the program
 * runs without kit mode and must serve no kit request.
 */
export async function runTerminalKit(run: TerminalKitRun): Promise<TerminalKitReport> {
  const ports: PinnedRunPorts = { read: run.read, stage: run.programs.stage, run: run.programs.run, env: run.env };
  let made = 0;
  const bound = bind({
    contract: TERMINAL_CONTRACT,
    make: () => {
      made += 1;
      const transport = pinnedTransport(run.pin, ports, { kitWorld: `${run.runId}-${made}` });
      return { port: protocolTerminal(transport), world: kitWorld(transport) };
    },
  });
  const { runs, skipped } = casesOn(bound.cases, run.os);
  return { cases: await runCases(runs), skipped, leaks: await kitLeaks(pinnedTransport(run.pin, ports)) };
}

/** The cases that run on `os` (every one when it is undefined), and the ids of the rest. */
export function casesOn(cases: readonly BoundCase[], os: Os | undefined): { readonly runs: readonly BoundCase[]; readonly skipped: readonly string[] } {
  const runsOn = (one: BoundCase): boolean => os === undefined || one.os.includes(os);
  return { runs: cases.filter(runsOn), skipped: cases.filter((one) => !runsOn(one)).map((one) => one.id) };
}
