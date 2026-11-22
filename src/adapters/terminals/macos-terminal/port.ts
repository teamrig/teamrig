import { INTERFACE_VERSION, shellCommand, type OpenAnswer, type PaneOpen, type TerminalDeps, type TerminalPort, type Unserved } from '../../../plugin-api/index.ts';

const UNSERVED: Unserved = { kind: 'unserved' };

/** Terminal's own words for a pane it cannot open: osascript is not on PATH, which a Mac always has. */
const NOT_INSTALLED = 'osascript is not installed';

/**
 * The script Terminal runs: its one run argument is the pane's command as shell text, so nothing of the command is
 * ever read as AppleScript. Without `activate`, Terminal opens the window behind the app the person is in.
 */
function script(focus: PaneOpen['focus']): string[] {
  const lines = ['on run argv', 'tell application "Terminal"', ...(focus === 'take' ? ['activate'] : []), 'do script (item 1 of argv)', 'end tell', 'end run'];
  return lines.flatMap((line) => ['-e', line]);
}

/**
 * The macOS Terminal port: a pane is a window `do script` opens. Terminal hands back no id of it, so the pane it
 * answers is the title teamrig asked for, which finds nothing again; it opens panes and serves nothing else.
 */
export function macosTerminalPort(deps: TerminalDeps): TerminalPort {
  return {
    capabilities: async () => ({ requests: ['open'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
    open: async (request: PaneOpen): Promise<OpenAnswer> => {
      const outcome = await deps.processes.start({
        command: 'osascript',
        // `do script` takes shell text: the only launcher that does, so every argument is quoted.
        args: [...script(request.focus), shellCommand('darwin', request.folder, request.argv)],
        cwd: request.folder,
        mode: 'exit',
      });
      switch (outcome.kind) {
        case 'started':
          return { kind: 'opened', pane: request.title };
        case 'missing':
          return { kind: 'failed', why: NOT_INSTALLED };
        case 'failed':
          return { kind: 'failed', why: outcome.error };
      }
    },
    focus: async () => UNSERVED,
    close: async () => UNSERVED,
    restart: async () => UNSERVED,
    rename: async () => UNSERVED,
    deliver: async () => UNSERVED,
    isIdle: async () => UNSERVED,
    list: async () => UNSERVED,
  };
}
