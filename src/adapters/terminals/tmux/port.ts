import { INTERFACE_VERSION, type OpenAnswer, type PaneAnswer, type PaneOpen, type PaneSplit, type SplitAnswer, type StartOutcome, type TerminalDeps, type TerminalPort, type Unserved } from '../../../plugin-api/index.ts';

const UNSERVED: Unserved = { kind: 'unserved' };

/** tmux's own words for a pane it cannot open or find: its program is not on PATH. */
const NOT_INSTALLED = 'tmux is not installed';

/**
 * The tmux port: a pane is a tmux window named by its title, which is the id it answers and finds the window by
 * again. It opens, splits and focuses panes and serves nothing else, as its declaration says.
 */
export function tmuxPort(deps: TerminalDeps): TerminalPort {
  /** What a launch that started nothing answers, in tmux's words. */
  function notStarted(outcome: Exclude<StartOutcome, { kind: 'started' }>): { readonly kind: 'failed'; readonly why: string } {
    return { kind: 'failed', why: outcome.kind === 'missing' ? NOT_INSTALLED : outcome.error };
  }

  return {
    capabilities: async () => ({ requests: ['open', 'split', 'focus'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
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
    split: async (request: PaneSplit): Promise<SplitAnswer> => {
      // split-window splits the pane this run works in, which tmux names in TMUX_PANE; -h puts the new one beside it.
      const keep = request.focus === 'keep' ? ['-d'] : [];
      const outcome = await deps.processes.start({
        command: 'tmux',
        args: ['split-window', '-h', ...keep, '-c', request.folder, ...request.argv],
        cwd: request.folder,
        mode: 'exit',
      });
      return outcome.kind === 'started' ? { kind: 'split' } : notStarted(outcome);
    },
    close: async () => UNSERVED,
    restart: async () => UNSERVED,
    rename: async () => UNSERVED,
    deliver: async () => UNSERVED,
    isIdle: async () => UNSERVED,
    list: async () => UNSERVED,
  };
}
