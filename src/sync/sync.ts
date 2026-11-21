import { formatUtcDay } from '../core/time.ts';
import type { ImportSource } from '../register/model.ts';
import type { ImportChanges, ImportInput, StatusInput, Verdict } from '../register/policy.ts';
import type { WriteResult } from '../register/register.ts';
import type { SyncStep } from './plan.ts';

const DAY_MS = 86_400_000;

/** The register's import writes (register.ts), the only writes a sync makes; each names the tracker it writes for. */
export interface ImportWriter {
  importAdd(source: ImportSource, input: ImportInput): Promise<Verdict<WriteResult>>;
  importUpdate(source: ImportSource, id: string, changes: ImportChanges, note: string): Promise<Verdict<WriteResult>>;
  importStatus(source: ImportSource, id: string, input: StatusInput): Promise<Verdict<WriteResult>>;
}

/** A step as written: the task it wrote, or why the register refused it. */
export interface StepOutcome {
  readonly step: SyncStep;
  readonly result: Verdict<string>;
}

/** The first day whose closed issues a sync reads: `closedDays` before now, UTC. */
export function closedSince(now: Date, closedDays: number): string {
  return formatUtcDay(new Date(now.getTime() - closedDays * DAY_MS));
}

/**
 * Writes one tracker's steps in order, as that tracker's import, each judged again under the register's lock; a
 * refused step is reported and the rest still run.
 */
export async function applySteps(writer: ImportWriter, source: ImportSource, steps: readonly SyncStep[]): Promise<StepOutcome[]> {
  const outcomes: StepOutcome[] = [];
  for (const step of steps) {
    const verdict = await writeStep(writer, source, step);
    outcomes.push({ step, result: verdict.ok ? { ok: true, value: verdict.value.task.id } : verdict });
  }
  return outcomes;
}

function writeStep(writer: ImportWriter, source: ImportSource, step: SyncStep): Promise<Verdict<WriteResult>> {
  switch (step.kind) {
    case 'add':
      return writer.importAdd(source, step.input);
    case 'update':
      return writer.importUpdate(source, step.id, step.changes, step.note);
    case 'status':
      return writer.importStatus(source, step.id, step.input);
  }
}
