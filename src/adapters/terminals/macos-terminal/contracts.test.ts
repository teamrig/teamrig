import { bind, TERMINAL_CONTRACT, type ShownPane, type TerminalWorld } from '../../../conformance/index.ts';
import type { RunOutcome, RunRequest, StartOutcome, StartRequest, TerminalProcesses } from '../../../plugin-api/index.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import { macosTerminalPort } from './port.ts';

/** The POSIX shell words of `cd '<folder>' && '<arg>' ...`, each single-quoted as shellCommand writes them. */
function shellWords(text: string): readonly string[] | undefined {
  const match = /^cd ('(?:[^']|'\\'')*') && (.*)$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const words = [...`${match[1]} ${match[2]}`.matchAll(/'((?:[^']|'\\'')*)'/g)].map((word) => (word[1] ?? '').replaceAll("'\\''", "'"));
  return words.length >= 2 ? words : undefined;
}

/** Terminal itself, faked: the `do script` osascript runs, read from its run argument. Terminal gives a window no id teamrig keeps, nor teamrig's title. */
class FakeTerminal implements TerminalProcesses {
  private readonly shown: ShownPane[] = [];

  async start(request: StartRequest): Promise<StartOutcome> {
    const words = request.command === 'osascript' ? shellWords(request.args.at(-1) ?? '') : undefined;
    const [folder, ...argv] = words ?? [];
    if (folder === undefined || !request.args.includes('do script (item 1 of argv)')) {
      return { kind: 'failed', error: `fake Terminal cannot read ${request.args.join(' ')}` };
    }
    const window = `window ${this.shown.length + 1}`;
    this.shown.push({ pane: window, title: window, folder, argv, window: undefined });
    return { kind: 'started', end: 'exited' };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    return { kind: 'failed', error: `the macOS Terminal port runs nothing, yet ran ${request.command}` };
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

const NO_ID = 'Terminal hands back no id of the window it opened, nor shows the title teamrig asked for';

describeContracts({
  side: 'terminal',
  declaration,
  bound: [
    bind({
      contract: TERMINAL_CONTRACT,
      make: () => {
        const terminal = new FakeTerminal();
        return { port: macosTerminalPort(terminalDeps({ platform: 'darwin', processes: terminal })), world: terminal.world() };
      },
      without: { 'terminal.open-shows-the-pane': NO_ID, 'terminal.open-ids-differ': NO_ID },
    }),
  ],
});
