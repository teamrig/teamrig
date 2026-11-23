import { isRecord } from "../core/guards.js";
import { isAssignedScope } from "./scope.js";
/** The version of the file a connector's places' scopes are kept in; a file of another version reads as none. */
export const SCOPE_FILE_FORMAT = 1;
function normal(values) {
    return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}
/** The mark of `request`'s scope with the people the tracker named (ScopeRequest.people). */
export function scopeMark(request) {
    const { all, assigned, labels } = request.scope;
    if (all) {
        return { all, assigned, labels: [], people: [] };
    }
    return { all, assigned, labels: normal(labels), people: assigned === 'team' ? normal(request.people) : [] };
}
/**
 * Whether `now` takes in an issue `before` could not: a place never taken, every issue after a scope, assignees
 * counted after labels alone, or a label or person `before` lacked. A scope that only narrows takes nothing new.
 */
export function widens(before, now) {
    if (before === undefined) {
        return true;
    }
    if (before.all) {
        return false;
    }
    if (now.all) {
        return true;
    }
    if (now.assigned === 'team' && before.assigned === 'none') {
        return true;
    }
    return now.labels.some((label) => !before.labels.includes(label)) || now.people.some((person) => !before.people.includes(person));
}
/** Whether two marks are the same scope. */
export function sameMark(a, b) {
    return a !== undefined && !widens(a, b) && !widens(b, a);
}
/** `plan` with its adds held back, its updates and status changes kept, and how many adds it held. */
export function holdAdds(plan) {
    const steps = plan.steps.filter((step) => step.kind !== 'add');
    const held = plan.steps.length - steps.length;
    return { plan: { ...plan, steps, inserted: plan.inserted - held }, held };
}
/**
 * The scope hold of one place. A preview changes nothing. A person's `--yes` takes the scope as it is. The automatic
 * sync takes a scope that is the same as or narrower than the one taken, so a later widening is held again; on a new
 * or wider one it adds nothing, keeps the held tasks current, and tells the lead once per scope.
 */
export function gateScope(kind, place, mark, plan) {
    if (kind === 'preview') {
        return { plan, held: 0, tell: false, place };
    }
    if (kind === 'yes') {
        return { plan, held: 0, tell: false, place: { taken: mark, told: undefined } };
    }
    if (!widens(place?.taken, mark)) {
        return { plan, held: 0, tell: false, place: { taken: mark, told: place?.told } };
    }
    const held = holdAdds(plan);
    const tell = held.held > 0 && !sameMark(place?.told, mark);
    return { plan: held.plan, held: held.held, tell, place: { taken: place?.taken, told: tell ? mark : place?.told } };
}
/**
 * The line telling the lead an automatic run held a place's adds: its scope is new or wider than a person last took,
 * and how many issues a run would add, at most `cap` a run.
 */
export function heldScopeLine(source, target, adds, cap) {
    return `${source} ${target}: the import scope is new or wider; ${adds} issue(s) would be added (${cap} a run at most). Run teamrig issue sync to review it, --yes to take it`;
}
function isStrings(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function markOf(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const { all, assigned, labels, people } = { all: value['all'], assigned: value['assigned'], labels: value['labels'], people: value['people'] };
    if (typeof all !== 'boolean' || !isAssignedScope(assigned) || !isStrings(labels) || !isStrings(people)) {
        return undefined;
    }
    return { all, assigned, labels, people };
}
/**
 * The places' scopes `text` holds. A file that is not one, or of another format, reads as no place, so every place
 * is new again and waits for a person's `--yes`: a lost file never widens what comes in.
 */
export function parseScopeFile(text) {
    const places = new Map();
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return places;
    }
    const found = isRecord(parsed) && parsed['format'] === SCOPE_FILE_FORMAT ? parsed['places'] : undefined;
    if (!isRecord(found)) {
        return places;
    }
    for (const [target, place] of Object.entries(found)) {
        if (isRecord(place)) {
            places.set(target, { taken: markOf(place['taken']), told: markOf(place['told']) });
        }
    }
    return places;
}
/** The file of `places`, read back by parseScopeFile. */
export function formatScopeFile(places) {
    return `${JSON.stringify({ format: SCOPE_FILE_FORMAT, places: Object.fromEntries(places) }, null, 2)}\n`;
}
