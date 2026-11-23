import { spawn } from 'node:child_process';
import type { CredentialKeeper } from './credentials.ts';
import type { ProgramRequest } from './program-runner.ts';
import { endOf, type ShellEnd } from './shell-end.ts';

/** The person's own terminal, which a command that asks them for a secret runs its program in. */
export interface Terminal {
  /** True when both stdin and stdout are a terminal: a person typing, not a session, a pipe or a file. */
  readonly interactive: boolean;
  /** Runs a program with this process's stdin, stdout and stderr to its end; rejects when it cannot start. */
  run(request: ProgramRequest): Promise<ShellEnd>;
}

/** What `teamrig key` writes with: the store's writes, and the terminal its save command asks the person in. */
export interface KeyPorts {
  readonly keeper: CredentialKeeper;
  readonly terminal: Terminal;
}

/** A stream that may be a terminal, as Node's process.stdin and process.stdout are. */
export interface MaybeTerminal {
  readonly isTTY?: boolean | undefined;
}

/**
 * The real terminal: the program shares this process's stdio, so what the person types goes to it and never passes
 * teamrig. No time limit, as it waits on the person.
 */
export function nodeTerminal(stdin: MaybeTerminal, stdout: MaybeTerminal): Terminal {
  return {
    interactive: stdin.isTTY === true && stdout.isTTY === true,
    run: (request) =>
      new Promise((resolve, reject) => {
        const env = request.env === undefined ? {} : { env: request.env };
        // Shown on purpose: the store's prompt must reach the person; it runs only from their own terminal.
        const child = spawn(request.program, [...request.args], { ...env, stdio: 'inherit' });
        child.once('error', reject);
        child.once('close', (code, signal) => resolve(endOf(code, signal)));
      }),
  };
}
