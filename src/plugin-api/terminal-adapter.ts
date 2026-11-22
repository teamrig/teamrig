import type { Env } from '../core/home.ts';
import type { TerminalProcesses } from '../open/processes.ts';
import { adapterEntry, declarationProblems, type AdapterDeclaration } from './declaration.ts';
import type { TerminalPort } from './terminal.ts';

/** What the adapter of a terminal says of itself. */
export type TerminalDeclaration = AdapterDeclaration<'terminal'>;

/** What the loader hands a terminal adapter to build its port from: nothing else of teamrig reaches it. */
export interface TerminalDeps {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** The launchers it starts and the programs it runs, each with no shell in between. */
  readonly processes: TerminalProcesses;
  /** The folder a program it runs starts in, where the request names no pane's own: teamrig's working folder. */
  readonly cwd: string;
}

/** What a terminal adapter builds: its one port, absent while the adapter only declares what its terminal can do. */
export interface TerminalPorts {
  readonly terminal?: TerminalPort;
}

/** The adapter of one terminal: its declaration, and the port it builds once the loader has accepted it. */
export interface TerminalAdapter {
  readonly declaration: TerminalDeclaration;
  readonly create: (deps: TerminalDeps) => TerminalPorts;
}

/** The default export of a terminal adapter's entry. */
export function defineTerminal(adapter: TerminalAdapter): TerminalAdapter {
  return adapter;
}

export function terminalDeclarationProblems(value: unknown): readonly string[] {
  return declarationProblems('terminal', value);
}

export function isTerminalDeclaration(value: unknown): value is TerminalDeclaration {
  return terminalDeclarationProblems(value).length === 0;
}

/** What stops `value` from being a terminal adapter's entry; empty when it is one. */
export function terminalAdapterProblems(value: unknown): readonly string[] {
  const entry = adapterEntry(value, 'create');
  return entry === undefined ? ['its entry is not made by defineTerminal: it needs a declaration and a create function'] : terminalDeclarationProblems(entry.declaration);
}

export function isTerminalAdapter(value: unknown): value is TerminalAdapter {
  return terminalAdapterProblems(value).length === 0;
}
