import { formatUtcDay } from "../core/time.js";
const DAY_MS = 86_400_000;
/** The first day whose closed issues a sync reads: `closedDays` before now, UTC. */
export function closedSince(now, closedDays) {
    return formatUtcDay(new Date(now.getTime() - closedDays * DAY_MS));
}
/**
 * Writes one tracker's steps in order, as that tracker's import, each judged again under the register's lock; a
 * refused step is reported and the rest still run.
 */
export async function applySteps(writer, source, steps) {
    const outcomes = [];
    for (const step of steps) {
        const verdict = await writeStep(writer, source, step);
        outcomes.push({ step, result: verdict.ok ? { ok: true, value: verdict.value.task.id } : verdict });
    }
    return outcomes;
}
function writeStep(writer, source, step) {
    switch (step.kind) {
        case 'add':
            return writer.importAdd(source, step.input);
        case 'update':
            return writer.importUpdate(source, step.id, step.changes, step.note);
        case 'status':
            return writer.importStatus(source, step.id, step.input);
    }
}
