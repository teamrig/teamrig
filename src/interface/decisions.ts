import type { Weekday } from '../config/types.ts';
import { MS_PER_DAY, parseDeadline } from '../core/time.ts';
import type { BatchTrigger, DecisionBatch, OwnerWait } from '../decisions/batch.ts';
import { cardLabel, unblockedBy } from '../meeting/decision-order.ts';
import { auditOf, type HandStepAudit } from '../register/hand-step.ts';
import { deferredUntil } from '../register/owner-waits.ts';
import { servedCard, type ServedCard } from './card.ts';
import { servedDue, servedNeed, type ServedDue, type ServedNeed } from './plan.ts';
import { servedWait, type ServedWait } from './tasks.ts';
import { ServedText, type Cut, type SecretShapes } from './text.ts';

/**
 * A card's hand step file, by its file name alone (a path is a place on someone's disk, which no document serves)
 * and the sha256 the task's audit pins it at; null when no audit on the task pins it, so the owner is not to run it.
 */
export interface ServedRunFile {
  readonly file: string;
  readonly sha256: string | null;
}

/** A card as `tasks` serves one, but its run file, served as {@link ServedRunFile}. */
export type ServedDecisionCard = Omit<ServedCard, 'run'> & { readonly run: ServedRunFile | null };

/** When a card the owner put off (Later) is asked again: as stored, and as ISO in UTC (null for a stored text that reads as no time). */
export interface ServedLater {
  readonly until: string;
  readonly at: string | null;
}

/**
 * One task waiting on the owner, as the lead's batch holds it. `team` is null for a task of the reader's own register
 * when it is the batch's own, else the team whose register holds it; `key` is how the batch names it (`T5`, `web/T5`).
 */
export interface ServedOwnerWait {
  readonly key: string;
  readonly id: string;
  readonly team: string | null;
  readonly owner: string;
  readonly status: string;
  readonly waits: readonly ServedWait[];
  /** The date it works to: its own due, or the earlier one of a task that needs it. */
  readonly due: ServedDue | null;
  readonly card: ServedDecisionCard | null;
  /** The active tasks of its register that wait on it, directly or not, as `plan` names a need: what the answer frees. */
  readonly frees: readonly ServedNeed[];
  /** Set on a card the owner put off; null on every other. */
  readonly later: ServedLater | null;
}

/** Why the batch is due now: a wait due before the next batch, `batchAt` waits not yet asked, or a batch time passed over waits. */
export type ServedTrigger =
  | { readonly kind: 'deadline'; readonly key: string; readonly at: string }
  | { readonly kind: 'count'; readonly pending: number; readonly batchAt: number }
  | { readonly kind: 'time'; readonly at: string };

/** The `decisions` document's own fields. */
export interface DecisionsBody {
  /** When the batch was judged, ISO in UTC. */
  readonly at: string;
  /**
   * The first moment after `at` an answer here may change with no file moving: the next batch time, a wait's due, a
   * put-off card coming back, the UTC day turning (the Improvements day). The revision covers files and never the
   * clock, so once it has passed a reader asks again without `--unless`.
   */
  readonly validUntil: string | null;
  /** The lead at the tree's root who asks the owner this team's waits, for a team under it; null when the team's own lead does. */
  readonly askedBy: string | null;
  /** The UTC weekday the waits held for the Improvements batch are asked. */
  readonly improvementsDay: Weekday;
  /** Why the batch is due now; null while it waits for the next. */
  readonly trigger: ServedTrigger | null;
  /** The next batch time, ISO in UTC; null with none set, when the next batch is the daily meeting. */
  readonly nextBatchAt: string | null;
  /** Not yet asked, in the order the lead asks them: register by register, each in its plan order. */
  readonly pending: readonly ServedOwnerWait[];
  /** Asked in an earlier batch and now past their due, in the same order. */
  readonly overdue: readonly ServedOwnerWait[];
  /** Held for the Improvements day's batch, as they free only Improvements work; empty on that day, when they are in `pending`. */
  readonly weekly: readonly ServedOwnerWait[];
  /** Left to a dedicated session's own meeting with the owner (`decisions.dedicatedOwners`), which no batch asks. */
  readonly dedicated: readonly ServedOwnerWait[];
  /** Put off by the owner (Later), the order kept; each is asked again once its time passed. */
  readonly later: readonly ServedOwnerWait[];
  readonly cuts: readonly Cut[];
}

/** What the `decisions` document is built from. */
export interface DecisionsInput {
  /** The batch that holds the team's waits, as `teamrig decisions` reads it (narrowed to the team's own for a team under the root). */
  readonly batch: DecisionBatch;
  /** The lead who asks the batch, by address, for a team under the root; null for a root team. */
  readonly askedBy: string | null;
  readonly now: number;
  readonly shapes: SecretShapes;
}

/**
 * The `decisions` document's body: the batch's waits served group by group in the batch's own order, so a reader
 * re-sorts nothing. It makes its own `ServedText`, so `cuts` lists this document's cuts and no other's.
 */
export function decisionsBody(input: DecisionsInput): DecisionsBody {
  const { batch, now } = input;
  const served = new ServedText(input.shapes);
  const serve = (waits: readonly OwnerWait[]): ServedOwnerWait[] => waits.map((wait) => servedOwnerWait(wait, served));
  const body = {
    pending: serve(batch.pending),
    overdue: serve(batch.overdue),
    weekly: serve(batch.weekly),
    dedicated: serve(batch.dedicated),
    later: serve(batch.later),
  };
  const turns = [...turnsOf(batch, now)].filter((at) => Number.isFinite(at) && at > now);
  return {
    at: new Date(now).toISOString(),
    validUntil: turns.length === 0 ? null : new Date(Math.min(...turns)).toISOString(),
    askedBy: input.askedBy,
    improvementsDay: batch.improvementsDay,
    trigger: batch.trigger === undefined ? null : servedTrigger(batch.trigger),
    nextBatchAt: batch.nextAt === undefined ? null : new Date(batch.nextAt).toISOString(),
    ...body,
    cuts: served.cuts,
  };
}

function servedOwnerWait({ task, team, tree }: OwnerWait, served: ServedText): ServedOwnerWait {
  const key = cardLabel(team, task.id);
  const until = deferredUntil(task, tree.context);
  return {
    key,
    id: task.id,
    team: team ?? null,
    owner: task.owner,
    status: task.status,
    waits: task.waits.map(servedWait),
    due: servedDue(task.id, tree),
    // Its texts are scanned under the batch's key, so a cut names `web/T5` apart from the reader's own `T5`.
    card: task.card === null ? null : { ...servedCard(served, key, task.card), run: servedRun(task.card.run, task.audits) },
    frees: unblockedBy(task, tree)
      .filter((freed) => freed.id !== task.id)
      .map((freed) => servedNeed(freed.id, tree)),
    later: until === undefined ? null : { until, at: parseDeadline(until, tree.zone)?.toISOString() ?? null },
  };
}

/** A run file by its last part, on either OS's separator, and the sha256 an audit on the task pins it at. */
function servedRun(run: string | undefined, audits: readonly HandStepAudit[]): ServedRunFile | null {
  if (run === undefined) {
    return null;
  }
  return { file: run.split(/[\\/]+/).filter((part) => part !== '').at(-1) ?? '', sha256: auditOf(audits, run)?.sha256 ?? null };
}

function servedTrigger(trigger: BatchTrigger): ServedTrigger {
  switch (trigger.kind) {
    case 'deadline':
      return { kind: 'deadline', key: cardLabel(trigger.team, trigger.task.id), at: new Date(trigger.due).toISOString() };
    case 'count':
      return { kind: 'count', pending: trigger.pending, batchAt: trigger.batchAt };
    case 'time':
      return { kind: 'time', at: new Date(trigger.at).toISOString() };
  }
}

/**
 * The moments the batch may turn at with no file moving: the next batch time, the next UTC midnight (the
 * Improvements day), each wait's effective due, and each put-off card's time. A moment that turns nothing only costs
 * a reader one early read.
 */
function* turnsOf(batch: DecisionBatch, now: number): Generator<number> {
  if (batch.nextAt !== undefined) {
    yield batch.nextAt;
  }
  yield (Math.floor(now / MS_PER_DAY) + 1) * MS_PER_DAY;
  for (const { task, tree } of [...batch.pending, ...batch.overdue, ...batch.weekly, ...batch.dedicated, ...batch.later]) {
    yield tree.dueTime(task) ?? Number.NaN;
    const until = deferredUntil(task, tree.context);
    yield until === undefined ? Number.NaN : (parseDeadline(until, tree.zone)?.getTime() ?? Number.NaN);
  }
}
