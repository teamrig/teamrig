import type { ConfigLoad } from '../config/load.ts';
import { KIT_NAME } from '../core/home.ts';
import { WRITE_SWITCH } from '../core/settings-writers.ts';

/**
 * A one-time step teamrig needs its person to take, said in plain words: no format numbers or versions. Each is a
 * settings writer's run (`steps run <id> --yes`), so the person takes it, never an agent.
 */
export interface PendingStep {
  readonly id: string;
  /** What teamrig needs, in the person's words. */
  readonly title: string;
  /** Why, in one sentence. */
  readonly why: string;
  /** What the step changes, line by line, shown before it runs. */
  readonly preview: readonly string[];
  /** What the person types in a tab to take it. */
  readonly command: string;
}

/** What a step source reads to tell whether its step is pending. */
export interface StepInputs {
  readonly config: ConfigLoad;
}

/** One kind of step: the step when it is pending, else undefined. A new kind of step adds a source. */
export interface StepSource {
  readonly id: string;
  pendingOf(inputs: StepInputs): PendingStep | undefined;
}

/** What the person types to take the step `id`. */
export function stepCommandOf(id: string): string {
  return `/${KIT_NAME} steps run ${id} --${WRITE_SWITCH}`;
}

const CONFIG_FORMAT = 'config-format';

/**
 * The config file is in an older format: every command reads it updated in memory, and a write is refused until it is
 * written. Its preview is the migration's own change lines.
 */
export const CONFIG_FORMAT_STEP: StepSource = {
  id: CONFIG_FORMAT,
  pendingOf({ config }) {
    if (config.status !== 'loaded' || config.pending === undefined || config.newerVersion !== undefined) {
      return undefined;
    }
    return {
      id: CONFIG_FORMAT,
      title: `${KIT_NAME} needs to update your team settings`,
      why: `the team settings file is in an older layout, so changing a setting is refused until it is updated; a backup is kept first`,
      preview: config.pending.changes,
      command: stepCommandOf(CONFIG_FORMAT),
    };
  },
};

/** Every kind of step, in the order they are shown and taken. */
export const STEP_SOURCES: readonly StepSource[] = [CONFIG_FORMAT_STEP];

/** The steps pending now, in `sources` order. */
export function pendingSteps(inputs: StepInputs, sources: readonly StepSource[] = STEP_SOURCES): PendingStep[] {
  return sources.flatMap((source) => {
    const step = source.pendingOf(inputs);
    return step === undefined ? [] : [step];
  });
}

/**
 * The lead's start line for each pending step: a step is the person's to take, so the lead tells them what it is and
 * what to type, and `steps` shows what it changes.
 */
export function startStepLines(steps: readonly PendingStep[]): string[] {
  return steps.map((step) => `STEP for the person: ${step.title}; they type: ${step.command} (${KIT_NAME} steps shows what it changes)`);
}

/** The source of the step `id`, or undefined when no kind of step has that id. */
export function stepSourceOf(id: string, sources: readonly StepSource[] = STEP_SOURCES): StepSource | undefined {
  return sources.find((source) => source.id === id);
}
