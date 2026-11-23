import { ServedText, type Cut, type SecretShapes } from './text.ts';

/**
 * One step teamrig needs its person to take, as the `steps` document serves it: what it is in plain words, why, what
 * it changes and what the person types to take it. A reader shows the step and offers its `command`; the step runs
 * only from the person's own tab, so no reader takes it.
 */
export interface ServedStep {
  /** The step's kind, such as `config-format`: what `steps run <id>` takes. */
  readonly id: string;
  readonly title: string;
  readonly why: string;
  /** What the step changes, a line each, as `steps` prints them before a run. */
  readonly preview: readonly string[];
  /** What the person types in a tab to take the step. */
  readonly command: string;
}

/** The `steps` document's own fields. */
export interface StepsBody {
  readonly steps: readonly ServedStep[];
  readonly cuts: readonly Cut[];
}

/**
 * A pending step as it is handed in: a `PendingStep` (src/steps/pending.ts) fits it as it is. It is declared here and
 * not imported, since that file reaches the config loader and nothing in this folder may.
 */
export type StepInput = ServedStep;

/** What the `steps` document is built from. */
export interface StepsInput {
  /** The pending steps, in the order they are shown and taken. */
  readonly steps: readonly StepInput[];
  readonly shapes: SecretShapes;
}

/**
 * The `steps` document's body. A preview line quotes the config file's values, which a hand edit may have filled, so
 * each is looked at for a secret's shape by itself, and so is every other text.
 */
export function stepsBody(input: StepsInput): StepsBody {
  const served = new ServedText(input.shapes);
  const steps = input.steps.map(
    (step): ServedStep => ({
      id: step.id,
      title: served.plain(step.id, 'title', step.title),
      why: served.plain(step.id, 'why', step.why),
      preview: step.preview.map((line) => served.plain(step.id, 'preview', line)),
      command: step.command,
    }),
  );
  return { steps, cuts: served.cuts };
}
