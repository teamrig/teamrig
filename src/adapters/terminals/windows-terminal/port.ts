import {
  INTERFACE_VERSION,
  powerShellRequest,
  windowsCommandLine,
  type OpenAnswer,
  type PaneAnswer,
  type PaneOpen,
  type StartOutcome,
  type StartRequest,
  type TerminalDeps,
  type TerminalPort,
  type Unserved,
} from '../../../plugin-api/index.ts';
import { FOCUS_EXIT, FOCUS_SCRIPT, FOCUS_TITLE_VAR, KEEP_FOCUS_ARGS_VAR, KEEP_FOCUS_EXIT, KEEP_FOCUS_PROGRAM_VAR, KEEP_FOCUS_SCRIPT } from './scripts.ts';

const UNSERVED: Unserved = { kind: 'unserved' };

/**
 * Windows Terminal re-reads its command line: `;` starts its next command, and it may expand `%VAR%` and re-quote
 * `"`. teamrig's own arguments (ids, base64url) never hold these; a path might.
 */
const UNSAFE = /[;"%\p{Cc}]/u;

/** The launcher that opens the pane's tab: `-w 0` is the most recent window; a name is the window of that name, made when none is open. */
export function launcherOf(request: PaneOpen): StartRequest {
  const { title, folder, argv, window } = request;
  return { command: 'wt.exe', args: ['-w', window ?? '0', 'new-tab', '--title', title, '-d', folder, '--', ...argv], cwd: request.folder, mode: 'exit' };
}

/** What the keep-focus script's exit says of the launch, as a plain start would have said it. */
function keptStartOf(launcher: StartRequest, code: number): StartOutcome {
  switch (code) {
    case 0:
    // The tab is open; only the focus stayed with it, which no caller acts on.
    case KEEP_FOCUS_EXIT.focusLost:
      return { kind: 'started', end: 'exited' };
    case KEEP_FOCUS_EXIT.running:
      return { kind: 'started', end: 'running' };
    case KEEP_FOCUS_EXIT.missing:
      return { kind: 'missing' };
    case KEEP_FOCUS_EXIT.launcherFailed:
      return { kind: 'failed', error: `${launcher.command} exited with an error` };
    default:
      return { kind: 'failed', error: `the script that keeps the focus failed (exit ${code})` };
  }
}

/**
 * What the focus script's exit code answers: done, selected when Windows' foreground lock kept another app's window in
 * front of the selected tab, gone when no tab has the title, else failed with why.
 */
function focusAnswerOf(code: number): PaneAnswer {
  switch (code) {
    case 0:
      return { kind: 'done' };
    case FOCUS_EXIT.behind:
      return { kind: 'selected' };
    case FOCUS_EXIT.noTab:
      return { kind: 'gone' };
    default:
      return { kind: 'failed', why: `Windows Terminal could not be searched (exit ${code})` };
  }
}

/**
 * The Windows Terminal port: a pane is a tab opened by `wt.exe new-tab --title`, in the window named for it, and its
 * title is the id it answers and finds the tab by again, through UI Automation. It opens and focuses panes and
 * serves nothing else, as its declaration says.
 */
export function windowsTerminalPort(deps: TerminalDeps): TerminalPort {
  /** Starts the launcher through the keep-focus script. Without Windows PowerShell, it starts plainly: the tab then takes the focus rather than not opening at all. */
  async function startKeepingFocus(launcher: StartRequest): Promise<StartOutcome> {
    const { program, args } = powerShellRequest(KEEP_FOCUS_SCRIPT);
    const env = { ...deps.env, [KEEP_FOCUS_PROGRAM_VAR]: launcher.command, [KEEP_FOCUS_ARGS_VAR]: windowsCommandLine(launcher.args) };
    const outcome = await deps.processes.run({ command: program, args, cwd: launcher.cwd, env });
    return outcome.kind === 'exited' ? keptStartOf(launcher, outcome.code) : deps.processes.start(launcher);
  }

  return {
    capabilities: async () => ({ requests: ['open', 'focus'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
    open: async (request: PaneOpen): Promise<OpenAnswer> => {
      const unsafe = [request.title, request.folder, ...(request.window === undefined ? [] : [request.window]), ...request.argv].find((arg) => UNSAFE.test(arg));
      if (unsafe !== undefined) {
        return { kind: 'failed', why: `Windows Terminal would misread ${JSON.stringify(unsafe)} (it holds ; " % or a control character)` };
      }
      const launcher = launcherOf(request);
      const outcome = request.focus === 'keep' ? await startKeepingFocus(launcher) : await deps.processes.start(launcher);
      switch (outcome.kind) {
        case 'started':
          return { kind: 'opened', pane: request.title };
        case 'missing':
          return { kind: 'failed', why: 'Windows Terminal is not installed' };
        case 'failed':
          return { kind: 'failed', why: outcome.error };
      }
    },
    focus: async (pane: string): Promise<PaneAnswer> => {
      const { program, args } = powerShellRequest(FOCUS_SCRIPT);
      const outcome = await deps.processes.run({ command: program, args, cwd: deps.cwd, env: { ...deps.env, [FOCUS_TITLE_VAR]: pane } });
      switch (outcome.kind) {
        case 'exited':
          return focusAnswerOf(outcome.code);
        case 'missing':
          return { kind: 'failed', why: 'Windows PowerShell is not installed' };
        case 'failed':
          return { kind: 'failed', why: outcome.error };
      }
    },
    split: async () => UNSERVED,
    close: async () => UNSERVED,
    restart: async () => UNSERVED,
    rename: async () => UNSERVED,
    deliver: async () => UNSERVED,
    isIdle: async () => UNSERVED,
    list: async () => UNSERVED,
  };
}
