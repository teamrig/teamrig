import { bind, TERMINAL_CONTRACT, type ShownPane, type TerminalWorld } from '../../../conformance/index.ts';
import type { RunOutcome, RunRequest, StartOutcome, StartRequest, TerminalProcesses } from '../../../plugin-api/index.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import { xTerminalEmulatorPort } from './port.ts';

/** The system's terminal, faked: `-T <title> -e <command>` as the port calls it, its shell starting in the launcher's folder. */
class FakeXTerminalEmulator implements TerminalProcesses {
  private readonly shown: ShownPane[] = [];

  async start(request: StartRequest): Promise<StartOutcome> {
    const [titleFlag, title, execute, ...argv] = request.args;
    if (request.command !== 'x-terminal-emulator' || titleFlag !== '-T' || title === undefined || execute !== '-e') {
      return { kind: 'failed', error: `fake x-terminal-emulator cannot read ${request.args.join(' ')}` };
    }
    this.shown.push({ pane: title, title, folder: request.cwd, argv, window: undefined });
    return { kind: 'started', end: 'spawned' };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    return { kind: 'failed', error: `the x-terminal-emulator port runs nothing, yet ran ${request.command}` };
  }

  world(): TerminalWorld {
    return {
      panes: () => [...this.shown],
      front: () => this.shown.at(-1)?.pane,
      put: () => undefined,
      openByHand: (title: string) => {
        this.shown.push({ pane: title, title, folder: '/work', argv: [], window: undefined });
        return title;
      },
      wakes: () => [],
      restarts: () => [],
    };
  }
}

describeContracts({
  side: 'terminal',
  declaration,
  bound: [
    bind({
      contract: TERMINAL_CONTRACT,
      make: () => {
        const terminal = new FakeXTerminalEmulator();
        return { port: xTerminalEmulatorPort(terminalDeps({ processes: terminal })), world: terminal.world() };
      },
    }),
  ],
});
