import type { Task } from '../register/fold.ts';
import type { WaitReason } from '../register/waits.ts';
import { servedCard, type ServedCard } from './card.ts';
import type { Connector } from './connector.ts';
import { refOf, type ServedRef } from './ref.ts';
import { sourceOf, type ServedSource, type SourceNames } from './source.ts';
import { ServedText, type Cut, type MarkedText, type SecretShapes } from './text.ts';

/**
 * One thing a task waits for, as data: who must decide or approve, which task must finish, or the moment it waits
 * until. A minor may add a kind, so a reader passes over one it does not know.
 */
export type ServedWait =
  | { readonly kind: 'decision' | 'approval'; readonly who: string }
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'time'; readonly at: string };

/** The lead's answer to the approval a task waits on. */
export interface ServedAnswer {
  /** A plain string, not the register's own list: a minor may add a verdict. */
  readonly verdict: string;
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

/** The owner's decision on a task's card, as a leader recorded it. */
export interface ServedDecision {
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

/**
 * A task as the `tasks` document serves it. Every field is named here, one by one, since this list is the contract:
 * a field the register gains is not served until it is added here, in a minor. `status`, `type` and the answer's
 * `verdict` are plain strings on purpose, so a value a minor adds reaches a reader of an older one, which draws
 * what it does not know as it sees fit.
 */
export interface ServedTask {
  readonly id: string;
  readonly title: MarkedText;
  readonly description: MarkedText | null;
  readonly owner: string;
  /** 1 is the most urgent. */
  readonly priority: number;
  /** Null when no one set it, which reads as a task. */
  readonly type: string | null;
  readonly critical: boolean;
  /** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`, UTC; a bare day means its end. */
  readonly due: string | null;
  readonly status: string;
  readonly note: string | null;
  readonly proof: string | null;
  readonly evidence: string | null;
  readonly skill: string | null;
  readonly statusAt: string;
  readonly source: ServedSource;
  readonly ref: ServedRef | null;
  readonly goals: readonly string[];
  readonly week: string | null;
  /** What the task still costs, in percent of the weekly usage limit. */
  readonly size: number | null;
  /** The leader who pinned it to the top of its owner's list. */
  readonly pin: string | null;
  readonly workClass: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly priorityAt: string;
  readonly assignedAt: string;
  readonly ownerSeenAt: string | null;
  readonly waits: readonly ServedWait[];
  readonly answer: ServedAnswer | null;
  readonly decided: ServedDecision | null;
  /** The tasks to finish before this one starts. */
  readonly after: readonly string[];
  /** Since interface 1.6: what its wait on a decision or an approval asks; null on any other task. */
  readonly card: ServedCard | null;
  /**
   * Since 1.6: not null when the task has a description the register's snapshot left out, so `description` is null;
   * its length in UTF-16 code units and a hash that tells an edited text from the one cut.
   */
  readonly descriptionCut: ServedDescriptionCut | null;
  /** Since 1.6: what the task had cost on the day it got its current size, which its spend over size counts from. */
  readonly sizeBase: ServedSizeBase | null;
  /** Since 1.6: the goal slice the task prepares, a design, study or prep plan for it. */
  readonly prepares: ServedPrep | null;
  /** Since 1.6: true when a leader marked the task as serving no goal. */
  readonly noGoal: boolean;
  /** Since 1.6: when it first went in progress or verifying; null until then. */
  readonly startedAt: string | null;
  /** Since 1.6: when it last asked for something new, its creation at the latest; "waiting since". */
  readonly waitsAt: string;
}

/** A description the register's snapshot left out. */
export interface ServedDescriptionCut {
  readonly chars: number;
  readonly hash: string;
}

/** The spend a task's size counts from: the UTC day and the W counted on the task that day so far. */
export interface ServedSizeBase {
  readonly day: string;
  readonly w: number;
}

/** A goal slice a task prepares. */
export interface ServedPrep {
  readonly goal: string;
  readonly slice: number;
}

/** The `tasks` document's own fields. */
export interface TasksBody {
  readonly tasks: readonly ServedTask[];
  /**
   * Since 1.8: how many finished tasks the register's compaction left to the archive, every owner's even with an
   * owner asked: they are in no `tasks` row, so a count of done tasks from the rows leaves them out. 0 when none is.
   */
  readonly retired: number;
  /**
   * Since 1.10: on a paged read, the id of the last task this page serves while more remain, which the next page is
   * asked after (`--after`); null on the last page and on a read that asks for no page.
   */
  readonly next: string | null;
  readonly cuts: readonly Cut[];
}

/**
 * One page of the `tasks` document: the tasks served after `after` (from the first when null), as many as fit in
 * `maxBytes` of their JSON, and always at least one, so a page always moves on.
 */
export interface TasksPage {
  readonly after: string | null;
  readonly maxBytes: number;
}

/** Measures a page's JSON with the web's encoder: the interface imports no Node built-in, so any reader can run it. */
const UTF8 = new TextEncoder();

/** A page asked after a task the document does not serve: the set changed under the reader, or the id is wrong. */
export class UnknownCursorError extends Error {
  readonly after: string;

  constructor(after: string) {
    super(`--after ${after} names no task this tasks document serves: read it again from the first page`);
    this.name = 'UnknownCursorError';
    this.after = after;
  }
}

/** What the `tasks` document is built from. */
export interface TasksInput {
  /** The register's tasks, in the order to serve them. */
  readonly tasks: Iterable<Task>;
  /** How many finished tasks the register's compaction left to the archive. */
  readonly retired: number;
  /** Serve only this session's tasks; null serves every task. */
  readonly owner: string | null;
  readonly shapes: SecretShapes;
  readonly connectors: readonly Connector[];
  readonly names: SourceNames;
  /** The one page to serve; null serves every task in one answer. */
  readonly page: TasksPage | null;
}

/**
 * The `tasks` document's body. Each task is scanned with its own `ServedText`, so `cuts` lists the cuts of the
 * tasks served and no other's: a task left out by `owner`, or outside the page asked, adds no cut. A page is
 * measured in the UTF-8 bytes of its tasks' JSON with the commas between them, so a reader whose run output is
 * capped asks for pages that fit under its cap with room for the rest of the answer.
 * @throws UnknownCursorError when the page's `after` names no task served.
 */
export function tasksBody(input: TasksInput): TasksBody {
  const owned = [...input.tasks].filter((task) => input.owner === null || task.owner === input.owner);
  const from = firstServedIndex(owned, input.page?.after ?? null);
  const tasks: ServedTask[] = [];
  const cuts: Cut[] = [];
  let bytes = 0;
  for (const [index, task] of owned.entries()) {
    if (index < from) {
      continue;
    }
    const served = new ServedText(input.shapes);
    const built = servedTask(task, served, input);
    const last = tasks.at(-1);
    if (input.page !== null) {
      bytes += UTF8.encode(JSON.stringify(built)).byteLength + (last === undefined ? 0 : 1);
      if (last !== undefined && bytes > input.page.maxBytes) {
        return { tasks, retired: input.retired, next: last.id, cuts };
      }
    }
    tasks.push(built);
    cuts.push(...served.cuts);
  }
  return { tasks, retired: input.retired, next: null, cuts };
}

/** Where a page starts among the tasks served: just past `after`, or the first when null. */
function firstServedIndex(owned: readonly Task[], after: string | null): number {
  if (after === null) {
    return 0;
  }
  const at = owned.findIndex((task) => task.id === after);
  if (at === -1) {
    throw new UnknownCursorError(after);
  }
  return at + 1;
}

function servedTask(task: Task, served: ServedText, input: Pick<TasksInput, 'connectors' | 'names'>): ServedTask {
  const source = sourceOf(served, task.id, task.source, input.names);
  // A tracker's import carries its author's words: only the title and the description hold them, the rest is the team's.
  const wrote = source.kind === 'connector' ? 'outside' : 'team';
  return {
    id: task.id,
    title: served.marked(task.id, 'title', task.title, wrote),
    description: served.markedOrNull(task.id, 'description', task.description, wrote),
    owner: task.owner,
    priority: task.priority,
    type: task.type,
    critical: task.critical,
    due: task.due,
    status: task.status,
    note: served.plainOrNull(task.id, 'note', task.note),
    proof: served.plainOrNull(task.id, 'proof', task.proof),
    evidence: served.plainOrNull(task.id, 'evidence', task.evidence),
    skill: served.plainOrNull(task.id, 'skill', task.skill),
    statusAt: task.statusAt,
    source,
    ref: refOf(served, task.id, task.ref, input.connectors),
    goals: [...task.goals],
    week: task.week,
    size: task.size,
    pin: task.pin,
    workClass: task.workClass,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    updatedBy: task.updatedBy,
    priorityAt: task.priorityAt,
    assignedAt: task.assignedAt,
    ownerSeenAt: task.ownerSeenAt,
    waits: task.waits.map(servedWait),
    answer:
      task.answer === null
        ? null
        : { verdict: task.answer.verdict, by: task.answer.by, at: task.answer.at, note: served.plainOrNull(task.id, 'answer.note', task.answer.note) },
    decided: task.decided === null ? null : { by: task.decided.by, at: task.decided.at, note: served.plainOrNull(task.id, 'decided.note', task.decided.note) },
    after: [...task.after],
    card: task.card === null ? null : servedCard(served, task.id, task.card),
    descriptionCut: task.descriptionCut === null ? null : { chars: task.descriptionCut.chars, hash: task.descriptionCut.hash },
    sizeBase: task.sizeBase === null ? null : { day: task.sizeBase.day, w: task.sizeBase.w },
    prepares: task.prepares === null ? null : { goal: task.prepares.goal, slice: task.prepares.slice },
    noGoal: task.noGoal,
    startedAt: task.startedAt,
    waitsAt: task.waitsAt,
  };
}

/** A wait written out field by field, so a field the register adds to a reason is not served by accident. */
export function servedWait(reason: WaitReason): ServedWait {
  switch (reason.kind) {
    case 'decision':
    case 'approval':
      return { kind: reason.kind, who: reason.who };
    case 'task':
      return { kind: 'task', id: reason.id };
    case 'time':
      return { kind: 'time', at: reason.at };
  }
}
