import { INTERFACE_VERSION, type OpenAnswer, type PaneOpen, type StartOutcome, type TerminalDeps, type TerminalPort, type Unserved } from '../../../plugin-api/index.ts';

const UNSERVED: Unserved = { kind: 'unserved' };

/**
 * What cmd reads in a line it runs, past the arguments themselves: `&`, `|`, `<` and `>` join or redirect commands,
 * `^` escapes, `%` expands a variable, and `"` would end the quotes Node puts around an argument. teamrig's own
 * arguments (ids, base64url) hold none; a path might.
 */
const CMD_UNSAFE = /[&|<>^%"\p{Cc}]/u;

/** The characters a tmux session name keeps as they are; tmux itself rewrites `.` and `:`, which address a pane. */
const TMUX_NAME_UNSAFE = /[^A-Za-z0-9_-]/g;

/** The tmux session a headless pane runs in: `teamrig-` and its title, each other character made `_`. */
export function tmuxSessionOf(title: string): string {
  return `teamrig-${title.replace(TMUX_NAME_UNSAFE, '_')}`;
}

/** The console host Windows ships in its own folder, which runs a console program with no window by `--headless`. */
export function conhostOf(env: TerminalDeps['env']): string {
  const root = (env['SystemRoot'] ?? '').trim();
  return `${root === '' ? 'C:\\Windows' : root.replace(/[\\/]+$/u, '')}\\System32\\conhost.exe`;
}

/** The command interpreter Windows names in `ComSpec`, which runs `start`. */
function comSpecOf(env: TerminalDeps['env']): string {
  const named = (env['ComSpec'] ?? '').trim();
  return named === '' ? 'cmd.exe' : named;
}

function answerOf(outcome: StartOutcome, pane: string, missing: string): OpenAnswer {
  switch (outcome.kind) {
    case 'started':
      return { kind: 'opened', pane };
    case 'missing':
      return { kind: 'failed', why: missing };
    case 'failed':
      return { kind: 'failed', why: outcome.error };
  }
}

/**
 * On Windows a pane is the program run under `conhost --headless`: a console of its own that no window shows. cmd's
 * `start` starts it, as conhost given standard handles (Node always hands a child some) reads them as a
 * pseudo-console's pipes, finds them empty and ends at once; `start` hands it none. cmd runs detached (`spawn`), so
 * what it starts is outside the job Node ends its children with, and runs on after this process.
 */
async function openOnWindows(deps: TerminalDeps, request: PaneOpen): Promise<OpenAnswer> {
  const unsafe = [request.folder, ...request.argv].find((arg) => CMD_UNSAFE.test(arg));
  if (unsafe !== undefined) {
    return { kind: 'failed', why: `cmd would misread ${JSON.stringify(unsafe)} (it holds & | < > ^ % " or a control character)` };
  }
  // The empty argument is `start`'s window title: without it, start would take a quoted program path for the title.
  const outcome = await deps.processes.start({
    command: comSpecOf(deps.env),
    args: ['/d', '/c', 'start', '', conhostOf(deps.env), '--headless', ...request.argv],
    cwd: request.folder,
    mode: 'spawn',
  });
  return answerOf(outcome, request.title, 'cmd is not installed');
}

/**
 * Elsewhere a pane is a detached tmux session of its own, which anyone can watch with `tmux attach`. tmux 3.0 and
 * later run a command given as several arguments without a shell; `-d` makes the session with no client attached.
 */
async function openWithTmux(deps: TerminalDeps, request: PaneOpen): Promise<OpenAnswer> {
  const session = tmuxSessionOf(request.title);
  const outcome = await deps.processes.start({
    command: 'tmux',
    args: ['new-session', '-d', '-s', session, '-c', request.folder, ...request.argv],
    cwd: request.folder,
    mode: 'exit',
  });
  return answerOf(outcome, session, 'tmux is not installed, which a headless session needs on this system');
}

/**
 * The headless port: a pane runs its command with no window, for a person who opts in to sessions they do not
 * watch. It opens panes and serves nothing else, as its declaration says: there is no window to focus, and a session
 * is woken, ended and restarted through teamrig's own hooks and launcher, the same as in a tab.
 */
export function headlessPort(deps: TerminalDeps): TerminalPort {
  return {
    capabilities: async () => ({ requests: ['open'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
    open: async (request: PaneOpen): Promise<OpenAnswer> => (deps.platform === 'win32' ? openOnWindows(deps, request) : openWithTmux(deps, request)),
    split: async () => UNSERVED,
    focus: async () => UNSERVED,
    close: async () => UNSERVED,
    restart: async () => UNSERVED,
    rename: async () => UNSERVED,
    deliver: async () => UNSERVED,
    isIdle: async () => UNSERVED,
    list: async () => UNSERVED,
  };
}
