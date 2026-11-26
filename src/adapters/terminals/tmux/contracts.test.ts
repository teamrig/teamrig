import { bind, TERMINAL_CONTRACT, type ShownPane, type TerminalWorld } from '../../../conformance/index.ts';
import type { PaneState, RunOutcome, RunRequest, StartOutcome, StartRequest, TerminalProcesses } from '../../../plugin-api/index.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import { tmuxPort } from './port.ts';

/** tmux itself, faked: `new-window`, `split-window` and `select-window` as the port calls them, read from their arguments. */
class FakeTmux implements TerminalProcesses {
  private readonly shown: ShownPane[] = [];
  private selected: string | undefined;

  async start(request: StartRequest): Promise<StartOutcome> {
    const [verb, ...rest] = request.args;
    if (request.command === 'tmux' && verb === 'split-window') {
      return this.split(rest);
    }
    if (request.command !== 'tmux' || verb !== 'new-window') {
      return { kind: 'failed', error: `fake tmux does not know ${request.command} ${verb ?? ''}` };
    }
    const keep = rest[0] === '-d';
    const [cFlag, folder, nFlag, title, ...argv] = keep ? rest.slice(1) : rest;
    if (cFlag !== '-c' || nFlag !== '-n' || folder === undefined || title === undefined) {
      return { kind: 'failed', error: `fake tmux cannot read ${request.args.join(' ')}` };
    }
    this.shown.push({ pane: title, title, folder, argv, window: undefined });
    if (!keep) {
      this.selected = title;
    }
    return { kind: 'started', end: 'exited' };
  }

  /** A split pane has no name of its own: tmux shows the command it runs, as the fake does for its title. */
  private split(rest: readonly string[]): StartOutcome {
    const [hFlag, ...after] = rest;
    const keep = after[0] === '-d';
    const [cFlag, folder, ...argv] = keep ? after.slice(1) : after;
    if (hFlag !== '-h' || cFlag !== '-c' || folder === undefined) {
      return { kind: 'failed', error: `fake tmux cannot read split-window ${rest.join(' ')}` };
    }
    const pane = `split-${this.shown.length}`;
    this.shown.push({ pane, title: argv[0] ?? '', folder, argv, window: undefined });
    if (!keep) {
      this.selected = pane;
    }
    return { kind: 'started', end: 'exited' };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    const [verb, tFlag, target] = request.args;
    if (request.command !== 'tmux' || verb !== 'select-window' || tFlag !== '-t' || target === undefined || !target.startsWith('=')) {
      return { kind: 'failed', error: `fake tmux does not know ${request.args.join(' ')}` };
    }
    const title = target.slice(1);
    if (!this.shown.some((shown) => shown.title === title)) {
      return { kind: 'exited', code: 1 };
    }
    this.selected = title;
    return { kind: 'exited', code: 0 };
  }

  world(): TerminalWorld {
    return {
      panes: () => [...this.shown],
      front: () => this.selected,
      put: (pane: string, state: PaneState) => {
        // tmux shows no session's state: only a pane that ends changes what it has.
        const at = this.shown.findIndex((shown) => shown.pane === pane);
        if (state === 'gone' && at >= 0) {
          this.shown.splice(at, 1);
        }
      },
      openByHand: (title: string) => {
        this.shown.push({ pane: title, title, folder: '/home', argv: [], window: undefined });
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
        const tmux = new FakeTmux();
        return { port: tmuxPort(terminalDeps({ processes: tmux })), world: tmux.world() };
      },
    }),
  ],
});
