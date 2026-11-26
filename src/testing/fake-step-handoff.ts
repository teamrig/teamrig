import type { RunRequest } from '../open/processes.ts';
import type { HandoffOutcome, StepHandoff } from '../open/step-handoff.ts';

/** A session launcher that keeps each plan a step hands it; `none` plays a step that no launcher started. */
export class FakeStepHandoff implements StepHandoff {
  readonly given: RunRequest[] = [];
  private readonly outcome: HandoffOutcome;

  constructor(outcome: HandoffOutcome = { kind: 'given' }) {
    this.outcome = outcome;
  }

  async give(run: RunRequest): Promise<HandoffOutcome> {
    if (this.outcome.kind === 'given') {
      this.given.push(run);
    }
    return this.outcome;
  }
}
