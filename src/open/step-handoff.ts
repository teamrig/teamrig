import { writeSync } from 'node:fs';
import { errorMessage } from '../core/guards.ts';
import type { Env } from '../core/home.ts';
import type { RunRequest } from './processes.ts';

/**
 * The variable the session launcher (src/open/session-launcher.ts) sets for a `launch --step` it starts: the number of
 * the pipe it reads that step's plan from. Only a step started with it hands a plan on, so no other open file of the
 * process is ever written to.
 */
export const STEP_HANDOFF_VAR = 'TEAMRIG_STEP_HANDOFF';

/** How handing the launcher a plan went: given, or no launcher started this step. */
export type HandoffOutcome = { readonly kind: 'given' } | { readonly kind: 'none' } | { readonly kind: 'failed'; readonly error: string };

/**
 * The session launcher that started this `launch --step`, a small process that stays in the tab: it runs the program
 * this step hands it, then starts the next step. Its own memory is all a tab keeps while its program runs (T5757).
 */
export interface StepHandoff {
  /** Hands the launcher the program to run next, as one JSON text on its pipe. */
  give(run: RunRequest): Promise<HandoffOutcome>;
}

/** The pipe number `env` names, when it is a whole number above stderr's 2. */
export function handoffPipeOf(env: Env): number | undefined {
  const value = env[STEP_HANDOFF_VAR]?.trim();
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const pipe = Number(value);
  return pipe > 2 ? pipe : undefined;
}

/** The real handoff: one write of the plan to the pipe `$TEAMRIG_STEP_HANDOFF` names, read by the launcher once this step exits. */
export function nodeStepHandoff(env: Env, write: (pipe: number, text: string) => void = (pipe, text) => {
  writeSync(pipe, text);
}): StepHandoff {
  return {
    give: async (run) => {
      const pipe = handoffPipeOf(env);
      if (pipe === undefined) {
        return { kind: 'none' };
      }
      try {
        write(pipe, JSON.stringify(run));
        return { kind: 'given' };
      } catch (error) {
        return { kind: 'failed', error: errorMessage(error) };
      }
    },
  };
}
