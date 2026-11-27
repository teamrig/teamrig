import type { Clock, Sleep } from '../core/lock.ts';
import type { ProcessInfo, SessionProcesses } from './session-processes.ts';

/** What ending a session's Claude Code and its tab needs: the automatic restart's and `teamrig close`'s. */
export interface TabEnder {
  readonly processes: SessionProcesses;
  readonly clock: Clock;
  readonly sleep: Sleep;
  readonly platform: NodeJS.Platform;
  /** The programs the hosts start a session with (`SessionLauncher.program`): a tab shell's command line names one. */
  readonly hostPrograms: readonly string[];
}

/** How long an ended process may take to go. */
export const END_WAIT_MS = 10_000;
const END_POLL_MS = 500;
/** A shell a tab runs Claude Code in, as a tab reopened by `powershell -NoExit -Command claude --resume ...`. */
const TAB_SHELL = /^(powershell|pwsh|cmd)(\.exe)?$/i;
/**
 * A shell Claude Code runs a command in (Bash, PowerShell, a Monitor's); a login shell's name starts with a dash.
 * Not cmd: an MCP server started through `cmd /c` runs as long as the session and ends with it anyway.
 */
const COMMAND_SHELL = /^-?(bash|sh|dash|zsh|fish|ksh|powershell|pwsh)(\.exe)?$/i;
/** A shell under Claude Code counts only when it is still there this much later: a status line command runs for moments. */
export const SHELL_RECHECK_MS = 2_000;

/** Whether `pid` is gone within `ms`, looking every `END_POLL_MS`. */
async function goneWithin(ender: TabEnder, pid: number, ms: number): Promise<boolean> {
  const deadline = ender.clock.now() + ms;
  while (ender.processes.alive(pid)) {
    if (ender.clock.now() >= deadline) {
      return false;
    }
    await ender.sleep(END_POLL_MS);
  }
  return true;
}

/** Ends `target`, then forces it if `watched` outlives the wait; why it failed, or undefined once `watched` is gone. */
export async function endAndWait(ender: TabEnder, target: number, watched: number): Promise<string | undefined> {
  for (const how of ['ask', 'force'] as const) {
    const ended = await ender.processes.end(target, how);
    if (ended.kind === 'failed') {
      return `could not end process ${target}: ${ended.error}`;
    }
    if (await goneWithin(ender, watched, END_WAIT_MS)) {
      return undefined;
    }
  }
  return `process ${watched} still runs after it was ended`;
}

/**
 * The process to end so the tab closes: on Windows, the shell the tab runs Claude Code in (ending it
 * ends Claude Code too), told by a command line naming a host's program; otherwise Claude Code itself, and its tab
 * stays open at a prompt.
 */
export async function tabProcessOf(ender: TabEnder, claude: ProcessInfo): Promise<number> {
  if (ender.platform !== 'win32') {
    return claude.pid;
  }
  const parent = await ender.processes.describe(claude.parentPid);
  if (parent === undefined || !TAB_SHELL.test(parent.name)) {
    return claude.pid;
  }
  return ender.hostPrograms.some((program) => namesProgram(parent.commandLine, program)) ? parent.pid : claude.pid;
}

/** A character a program's name can hold, so one beside a match makes it part of a longer word. */
const NAME_CHAR = '[a-z0-9_.-]';
/** The endings Windows starts a program by. */
const RUNNABLE_EXTENSION = '(?:\\.(?:exe|cmd|bat|ps1|com))?';

/**
 * Whether `commandLine` names `program` as a whole word, bare or as a path's last part, with or without a runnable
 * ending: a host named `agy` must not take a tab whose line says `strategy`. An empty name names nothing.
 */
function namesProgram(commandLine: string, program: string): boolean {
  if (program === '') {
    return false;
  }
  const escaped = program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!${NAME_CHAR})${escaped}${RUNNABLE_EXTENSION}(?!${NAME_CHAR})`, 'i').test(commandLine);
}

/** The command shells `pid` runs; undefined when the system would not tell. */
async function shellsUnder(ender: TabEnder, pid: number): Promise<readonly ProcessInfo[] | undefined> {
  return (await ender.processes.children(pid))?.filter((info) => COMMAND_SHELL.test(info.name));
}

/**
 * Why ending `claude` would cut off work it runs, or undefined when it would not. An end takes every process
 * it started, so a shell still there on two looks `SHELL_RECHECK_MS` apart (a background command, a Monitor)
 * would die with it, as would one the transcript's running work (`refresh/running.ts`) no longer shows: that
 * reads only the transcript's end and the last hours. A process list the system would not give counts as unsafe.
 * A /clear needs no such look: it keeps the background shells.
 */
export async function workCutOffBy(ender: TabEnder, claude: ProcessInfo): Promise<string | undefined> {
  const unknown = `teamrig could not list what its Claude Code (${claude.pid}) runs`;
  const seen = await shellsUnder(ender, claude.pid);
  if (seen === undefined) {
    return unknown;
  }
  if (seen.length === 0) {
    return undefined;
  }
  await ender.sleep(SHELL_RECHECK_MS);
  const again = await shellsUnder(ender, claude.pid);
  if (again === undefined) {
    return unknown;
  }
  const lasting = again.filter((shell) => seen.some((first) => first.pid === shell.pid));
  return lasting.length === 0 ? undefined : `ending its Claude Code would also end the background shells it runs (pid ${lasting.map((shell) => shell.pid).join(', ')})`;
}
