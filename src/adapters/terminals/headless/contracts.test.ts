import { bind, TERMINAL_CONTRACT, type ShownPane, type TerminalWorld } from '../../../conformance/index.ts';
import type { RunOutcome, RunRequest, StartOutcome, StartRequest, TerminalProcesses } from '../../../plugin-api/index.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import { headlessPort } from './port.ts';

/**
 * tmux, faked: `new-session -d -s <session> -c <folder> <command>` as the headless port calls it off Windows. The
 * pane's title is what the session was named after, kept beside the session name the port answers with.
 */
class FakeHeadlessTmux implements TerminalProcesses {
  private readonly shown: ShownPane[] = [];

  async start(request: StartRequest): Promise<StartOutcome> {
    const [verb, detached, nameFlag, session, folderFlag, folder, ...argv] = request.args;
    if (request.command !== 'tmux' || verb !== 'new-session' || detached !== '-d' || nameFlag !== '-s' || session === undefined || folderFlag !== '-c' || folder === undefined) {
      return { kind: 'failed', error: `fake tmux cannot read ${request.args.join(' ')}` };
    }
    if (this.shown.some((pane) => pane.pane === session)) {
      return { kind: 'failed', error: `duplicate session: ${session}` };
    }
    this.shown.push({ pane: session, title: session.replace(/^teamrig-/u, ''), folder, argv, window: undefined });
    return { kind: 'started', end: 'exited' };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    return { kind: 'failed', error: `the headless port runs nothing, yet ran ${request.command}` };
  }

  world(): TerminalWorld {
    return {
      panes: () => [...this.shown],
      front: () => undefined,
      put: () => undefined,
      openByHand: (title: string) => {
        const pane = `teamrig-${title}`;
        this.shown.push({ pane, title, folder: '/work', argv: [], window: undefined });
        return pane;
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
        const tmux = new FakeHeadlessTmux();
        return { port: headlessPort(terminalDeps({ processes: tmux })), world: tmux.world() };
      },
    }),
  ],
});
