import { bind, TERMINAL_CONTRACT, type ShownPane, type TerminalWorld } from '../../../conformance/index.ts';
import type { PaneState, RunOutcome, RunRequest, StartOutcome, StartRequest, TerminalProcesses } from '../../../plugin-api/index.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import { windowsTerminalPort } from './port.ts';
import { FOCUS_EXIT, FOCUS_TITLE_VAR } from './scripts.ts';

/**
 * Windows Terminal itself, faked: `wt.exe -w <window> new-tab` read from its arguments, and the focus script read
 * from the title it is handed. The contract opens with the focus taken, so the keep-focus script never runs here.
 */
class FakeWindowsTerminal implements TerminalProcesses {
  private readonly shown: ShownPane[] = [];
  private selected: string | undefined;

  async start(request: StartRequest): Promise<StartOutcome> {
    const [wFlag, window, verb, titleFlag, title, dFlag, folder, dashes, ...argv] = request.args;
    if (request.command !== 'wt.exe' || wFlag !== '-w' || verb !== 'new-tab' || titleFlag !== '--title' || dFlag !== '-d' || dashes !== '--') {
      return { kind: 'failed', error: `fake Windows Terminal cannot read ${request.args.join(' ')}` };
    }
    if (window === undefined || title === undefined || folder === undefined) {
      return { kind: 'failed', error: 'fake Windows Terminal misses an argument' };
    }
    this.shown.push({ pane: title, title, folder, argv, window: window === '0' ? undefined : window });
    this.selected = title;
    return { kind: 'started', end: 'exited' };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    const title = request.env[FOCUS_TITLE_VAR];
    if (request.command !== 'powershell.exe' || title === undefined) {
      return { kind: 'failed', error: `fake Windows Terminal does not know ${request.command}` };
    }
    if (!this.shown.some((shown) => shown.title === title)) {
      return { kind: 'exited', code: FOCUS_EXIT.noTab };
    }
    this.selected = title;
    return { kind: 'exited', code: 0 };
  }

  world(): TerminalWorld {
    return {
      panes: () => [...this.shown],
      front: () => this.selected,
      put: (pane: string, state: PaneState) => {
        // Windows Terminal shows no session's state: only a tab that ends changes what it has.
        const at = this.shown.findIndex((shown) => shown.pane === pane);
        if (state === 'gone' && at >= 0) {
          this.shown.splice(at, 1);
        }
      },
      openByHand: (title: string) => {
        this.shown.push({ pane: title, title, folder: 'C:\\Users\\someone', argv: [], window: undefined });
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
        const terminal = new FakeWindowsTerminal();
        return { port: windowsTerminalPort(terminalDeps({ platform: 'win32', processes: terminal })), world: terminal.world() };
      },
    }),
  ],
});
