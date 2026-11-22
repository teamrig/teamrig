import { INTERFACE_VERSION, type OpenAnswer, type PaneAnswer, type PaneOpen, type TerminalDeps, type TerminalPort, type Unserved } from '../../../plugin-api/index.ts';

const UNSERVED: Unserved = { kind: 'unserved' };

/** tmux's own words for a pane it cannot open or find: its program is not on PATH. */
const NOT_INSTALLED = 'tmux is not installed';

/**
 * The tmux port: a pane is a tmux window named by its title, which is the id it answers and finds the window by
 * again. It opens and focuses panes and serves nothing else, as its declaration says.
 */
export function tmuxPort(deps: TerminalDeps): TerminalPort {
  return {
    capabilities: async () => ({ requests: ['open', 'focus'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
    open: async (request: PaneOpen): Promise<OpenAnswer> => {
      // tmux 3.0 and later run a command given as several arguments without a shell; -d leaves the current window selected.
      const keep = request.focus === 'keep' ? ['-d'] : [];
      const outcome = await deps.processes.start({
        command: 'tmux',
        args: ['new-window', ...keep, '-c', request.folder, '-n', request.title, ...request.argv],
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
    focus: async (pane: string): Promise<PaneAnswer> => {
      // `=` takes the window named exactly so: a title's brackets are no pattern.
      const outcome = await deps.processes.run({ command: 'tmux', args: ['select-window', '-t', `=${pane}`], cwd: deps.cwd, env: deps.env });
      switch (outcome.kind) {
        case 'exited':
          return outcome.code === 0 ? { kind: 'done' } : { kind: 'gone' };
        case 'missing':
          return { kind: 'failed', why: NOT_INSTALLED };
        case 'failed':
          return { kind: 'failed', why: outcome.error };
      }
    },
    close: async () => UNSERVED,
    restart: async () => UNSERVED,
    rename: async () => UNSERVED,
    deliver: async () => UNSERVED,
    isIdle: async () => UNSERVED,
    list: async () => UNSERVED,
  };
}
