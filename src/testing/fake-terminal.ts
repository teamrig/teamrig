import type { ProgramRequest } from '../core/program-runner.ts';
import type { ShellEnd } from '../core/shell-end.ts';
import type { Terminal } from '../core/terminal.ts';

/** A terminal that records each program run in it; by default no person types (not interactive) and each run exits 0. */
export class FakeTerminal implements Terminal {
  readonly interactive: boolean;
  /** The programs run, in order. */
  readonly ran: ProgramRequest[] = [];
  private answer: (request: ProgramRequest) => ShellEnd = () => ({ kind: 'exited', code: 0 });

  constructor(interactive = false) {
    this.interactive = interactive;
  }

  /** From now on, each run does `act`, as the person typing into the program does, and ends as `act` returns. */
  answers(act: (request: ProgramRequest) => ShellEnd): this {
    this.answer = act;
    return this;
  }

  async run(request: ProgramRequest): Promise<ShellEnd> {
    this.ran.push(request);
    return this.answer(request);
  }
}
