import { INTERFACE_VERSION, type OpenAnswer, type PaneOpen, type TerminalDeps, type TerminalPort, type Unserved } from '../../../plugin-api/index.ts';

const UNSERVED: Unserved = { kind: 'unserved' };

const NOT_INSTALLED = 'x-terminal-emulator is not installed';

/**
 * The x-terminal-emulator port: a pane is a new window of whichever terminal the system names, titled by `-T`, the
 * one flag besides `-e` they all share. That title is the pane it answers; it opens panes and serves nothing else.
 */
export function xTerminalEmulatorPort(deps: TerminalDeps): TerminalPort {
  return {
    capabilities: async () => ({ requests: ['open'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
    open: async (request: PaneOpen): Promise<OpenAnswer> => {
      // No shared flag names a folder: the window's shell starts in the launcher's own. It is the window itself, so
      // starting it is all there is to wait for.
      const outcome = await deps.processes.start({
        command: 'x-terminal-emulator',
        args: ['-T', request.title, '-e', ...request.argv],
        cwd: request.folder,
        mode: 'spawn',
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
