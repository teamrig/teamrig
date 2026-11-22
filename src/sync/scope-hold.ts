import { isRecord } from '../core/guards.ts';
import type { SyncPlan } from './plan.ts';
import { isAssignedScope, type AssignedScope, type ScopeRequest } from './scope.ts';

/**
 * A place's scope as a run read it, kept to what decides which issues come in: the people only when assignees count,
 * labels and people in lower case, sorted and once each, so two runs of the same scope give equal marks.
 */
export interface ScopeMark {
  readonly all: boolean;
  readonly assigned: AssignedScope;
  readonly labels: readonly string[];
  readonly people: readonly string[];
}

/** What the import remembers of one place: the scope a person last took, and the wider one the lead was last told of. */
export interface PlaceScope {
  readonly taken: ScopeMark | undefined;
  readonly told: ScopeMark | undefined;
}

/** The version of the file a connector's places' scopes are kept in; a file of another version reads as none. */
export const SCOPE_FILE_FORMAT = 1;

function normal(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}

/** The mark of `request`'s scope with the people the tracker named (ScopeRequest.people). */
export function scopeMark(request: ScopeRequest): ScopeMark {
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
export function widens(before: ScopeMark | undefined, now: ScopeMark): boolean {
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
export function sameMark(a: ScopeMark | undefined, b: ScopeMark): boolean {
  return a !== undefined && !widens(a, b) && !widens(b, a);
}

/** `plan` with its adds held back, its updates and status changes kept, and how many adds it held. */
export function holdAdds(plan: SyncPlan): { readonly plan: SyncPlan; readonly held: number } {
  const steps = plan.steps.filter((step) => step.kind !== 'add');
  const held = plan.steps.length - steps.length;
  return { plan: { ...plan, steps, inserted: plan.inserted - held }, held };
}

/** How a run writes: a preview, a person's `--yes`, or the automatic sync (`--auto`). */
export type ScopeRunKind = 'preview' | 'yes' | 'auto';

/** What the hold makes of a place's run: the plan to apply, the adds it held, whether to tell the lead, and what to remember. */
export interface ScopeGate {
  readonly plan: SyncPlan;
  readonly held: number;
  readonly tell: boolean;
  readonly place: PlaceScope | undefined;
}

/**
 * The scope hold of one place. A preview changes nothing. A person's `--yes` takes the scope as it is. The automatic
 * sync takes a scope that is the same as or narrower than the one taken, so a later widening is held again; on a new
 * or wider one it adds nothing, keeps the held tasks current, and tells the lead once per scope.
 */
export function gateScope(kind: ScopeRunKind, place: PlaceScope | undefined, mark: ScopeMark, plan: SyncPlan): ScopeGate {
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
export function heldScopeLine(source: string, target: string, adds: number, cap: number): string {
  return `${source} ${target}: the import scope is new or wider; ${adds} issue(s) would be added (${cap} a run at most). Run teamrig issue sync to review it, --yes to take it`;
}

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function markOf(value: unknown): ScopeMark | undefined {
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
export function parseScopeFile(text: string): ReadonlyMap<string, PlaceScope> {
  const places = new Map<string, PlaceScope>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
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
export function formatScopeFile(places: ReadonlyMap<string, PlaceScope>): string {
  return `${JSON.stringify({ format: SCOPE_FILE_FORMAT, places: Object.fromEntries(places) }, null, 2)}\n`;
}
