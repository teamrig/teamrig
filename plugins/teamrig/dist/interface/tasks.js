import { servedCard } from "./card.js";
import { refOf } from "./ref.js";
import { sourceOf } from "./source.js";
import { ServedText } from "./text.js";
/** Measures a page's JSON with the web's encoder: the interface imports no Node built-in, so any reader can run it. */
const UTF8 = new TextEncoder();
/** A page asked after a task the document does not serve: the set changed under the reader, or the id is wrong. */
export class UnknownCursorError extends Error {
    after;
    constructor(after) {
        super(`--after ${after} names no task this tasks document serves: read it again from the first page`);
        this.name = 'UnknownCursorError';
        this.after = after;
    }
}
/**
 * The `tasks` document's body. Each task is scanned with its own `ServedText`, so `cuts` lists the cuts of the
 * tasks served and no other's: a task left out by `owner`, or outside the page asked, adds no cut. A page is
 * measured in the UTF-8 bytes of its tasks' JSON with the commas between them, so a reader whose run output is
 * capped asks for pages that fit under its cap with room for the rest of the answer.
 * @throws UnknownCursorError when the page's `after` names no task served.
 */
export function tasksBody(input) {
    const owned = [...input.tasks].filter((task) => input.owner === null || task.owner === input.owner);
    const from = firstServedIndex(owned, input.page?.after ?? null);
    const tasks = [];
    const cuts = [];
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
function firstServedIndex(owned, after) {
    if (after === null) {
        return 0;
    }
    const at = owned.findIndex((task) => task.id === after);
    if (at === -1) {
        throw new UnknownCursorError(after);
    }
    return at + 1;
}
function servedTask(task, served, input) {
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
        answer: task.answer === null
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
export function servedWait(reason) {
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
