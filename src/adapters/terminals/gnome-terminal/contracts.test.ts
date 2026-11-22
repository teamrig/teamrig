import { bind, TERMINAL_CONTRACT, type ShownPane, type TerminalWorld } from '../../../conformance/index.ts';
import type { RunOutcome, RunRequest, StartOutcome, StartRequest, TerminalProcesses } from '../../../plugin-api/index.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import { gnomeTerminalPort } from './port.ts';

const FOLDER_FLAG = '--working-directory=';

/** GNOME Terminal itself, faked: `--tab` as the port calls it, read from its arguments. It gives a tab no id teamrig keeps, nor teamrig's title. */
class FakeGnomeTerminal implements TerminalProcesses {
  private readonly shown: ShownPane[] = [];

  async start(request: StartRequest): Promise<StartOutcome> {
    const [tab, folderArg, dashes, ...argv] = request.args;
    if (request.command !== 'gnome-terminal' || tab !== '--tab' || folderArg === undefined || !folderArg.startsWith(FOLDER_FLAG) || dashes !== '--') {
      return { kind: 'failed', error: `fake gnome-terminal cannot read ${request.args.join(' ')}` };
    }
    const id = `tab ${this.shown.length + 1}`;
    this.shown.push({ pane: id, title: id, folder: folderArg.slice(FOLDER_FLAG.length), argv, window: undefined });
    return { kind: 'started', end: 'exited' };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    return { kind: 'failed', error: `the GNOME Terminal port runs nothing, yet ran ${request.command}` };
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

const NO_ID = 'GNOME Terminal hands back no id of the tab it opened, nor shows the title teamrig asked for';

describeContracts({
  side: 'terminal',
  declaration,
  bound: [
    bind({
      contract: TERMINAL_CONTRACT,
      make: () => {
        const terminal = new FakeGnomeTerminal();
        return { port: gnomeTerminalPort(terminalDeps({ processes: terminal })), world: terminal.world() };
      },
      without: { 'terminal.open-shows-the-pane': NO_ID, 'terminal.open-ids-differ': NO_ID },
    }),
  ],
});
