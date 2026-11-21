import { priorityText } from '../../register/model.ts';
import type { SyncPlan, SyncStep } from '../../sync/plan.ts';
import type { StepOutcome } from '../../sync/sync.ts';

/** How the sync of one repository ended, for the exit code. */
export type RepoEnd = 'ok' | 'failed' | 'refused';

/** The rows of steps a repository prints; the rest are counted. */
export const SHOWN_STEPS = 10;

/** The left-out issue numbers a repository's LEFT OUT line names; the rest are counted. */
export const SHOWN_LEFT_OUT = 20;

/** Why the task list refused some of a repository's steps: how many, and the first one's error; undefined when none was. */
export function refusedReason(outcomes: readonly StepOutcome[]): string | undefined {
  const errors = outcomes.flatMap((outcome) => (outcome.result.ok ? [] : [outcome.result.error]));
  return errors.length === 0 ? undefined : `the task list refused ${errors.length} step(s), first: ${errors[0]}`;
}

export function previewLines(repo: string, plan: SyncPlan): string[] {
  return [
    `REPO ${repo}: ${plan.inserted} to add, ${plan.changed} to change, ${plan.unchanged} unchanged`,
    ...shown(plan.steps.map((step) => stepLine(step, step.kind === 'add' ? 'new' : step.id))),
  ];
}

export function resultLines(repo: string, plan: SyncPlan, outcomes: readonly StepOutcome[]): string[] {
  const done = outcomes.filter((outcome) => outcome.result.ok);
  const added = done.filter((outcome) => outcome.step.kind === 'add').length;
  const changed = new Set(done.filter((outcome) => outcome.step.kind !== 'add').map((outcome) => outcome.step.ref)).size;
  const refused = outcomes.length - done.length;
  return [
    `REPO ${repo}: ${added} added, ${changed} changed, ${plan.unchanged} unchanged${refused > 0 ? `, ${refused} refused` : ''}`,
    ...shown(done.map((outcome) => stepLine(outcome.step, outcome.result.ok ? outcome.result.value : ''))),
    ...outcomes.flatMap((outcome) => (outcome.result.ok ? [] : [`SKIPPED ${outcome.step.ref}: ${outcome.result.error}`])),
  ];
}

/**
 * The line naming the open issues the trust rule (trust.ts) left out of a repository, and the label that lets
 * one in: their numbers only, as their text is an outsider's, at most SHOWN_LEFT_OUT and then how many more;
 * none when it left none out.
 */
export function leftOutLines(repo: string, leftOut: readonly number[], acceptLabel: string): string[] {
  if (leftOut.length === 0) {
    return [];
  }
  const more = leftOut.length - SHOWN_LEFT_OUT;
  const numbers = leftOut.slice(0, SHOWN_LEFT_OUT).map((number) => `#${number}`).join(' ');
  return [
    `LEFT OUT ${repo}: ${leftOut.length} open issue(s) by people outside the repository wait for someone to add the ${JSON.stringify(acceptLabel)} label: ${numbers}${more > 0 ? ` and ${more} more` : ''}`,
  ];
}

/** The first SHOWN_STEPS lines, then how many more there are. */
export function shown(lines: readonly string[]): string[] {
  const more = lines.length - SHOWN_STEPS;
  return more > 0 ? [...lines.slice(0, SHOWN_STEPS), `... and ${more} more`] : [...lines];
}

/** One step on one line; a title is outside input, so it is printed quoted, as data, and a description only by its length. */
export function stepLine(step: SyncStep, id: string): string {
  switch (step.kind) {
    case 'add':
      return `ADD ${id} ${step.ref} ${priorityText(step.input.priority)} ${step.input.owner}: ${JSON.stringify(step.input.title)}`;
    case 'update': {
      const { title, description, priority } = step.changes;
      const fields = [
        ...(title === undefined ? [] : [`title ${JSON.stringify(title)}`]),
        ...(description === undefined ? [] : [description === null ? 'description none' : `description (${description.length} characters)`]),
        ...(priority === undefined ? [] : [`priority ${priorityText(priority)}`]),
      ];
      return `UPDATE ${id} ${step.ref}: ${fields.join(', ')}`;
    }
    case 'status':
      return `SET ${id} ${step.ref} ${step.input.status}: ${step.input.note ?? ''}`;
  }
}
