import { KIT_NAME } from '../../core/home.ts';
import type { SyncConfig } from '../../config/types.ts';
import type { IssueTarget } from '../../issues/host.ts';
import type { HostIssue } from '../../issues/issue.ts';
import type { Task } from '../../register/fold.ts';
import type { SyncPlan } from '../../sync/plan.ts';
import { gateScope, heldScopeLine, scopeMark, type PlaceScope, type ScopeRunKind } from '../../sync/scope-hold.ts';
import { capPlan, scopeIssues, type CappedPlan, type ImportScope, type IssueRefOf, type ScopeRequest } from '../../sync/scope.ts';

/** What the scope of one place's import is judged with: the run, the place, its request and what the import already holds. */
export interface PlaceScopeRun {
  readonly kind: ScopeRunKind;
  /** The import source the lead's line names (register/model.ts). */
  readonly source: string;
  readonly target: string;
  readonly sync: Pick<SyncConfig, 'maxOpen' | 'maxNewPerSync'>;
  /** The request the list was read with, its people as the tracker named them. */
  readonly request: ScopeRequest;
  /** The scope a person last took at the place, undefined when none was taken. */
  readonly taken: PlaceScope | undefined;
  /** The active tasks the import holds from this tracker. */
  readonly active: number;
  /** The adds this run already planned at the tracker's earlier places, which the caps count. */
  readonly plannedAdds: number;
  readonly refOf: IssueRefOf;
}

/**
 * One place's import cut to its scope, its caps and its scope hold: the issues kept, the plan to apply, the scope to
 * remember, the SCOPE and CAPPED lines, the HELD line, and the lines for the lead about adds the hold kept back.
 */
export interface ScopedPlace {
  readonly issues: readonly HostIssue[];
  readonly plan: SyncPlan;
  readonly place: PlaceScope | undefined;
  readonly scopeLines: readonly string[];
  readonly heldLines: readonly string[];
  readonly scopeHolds: readonly string[];
}

/**
 * Cuts `issues`, as the tracker listed them, to the scope (sync/scope.ts), plans them with `planOf`, caps the adds
 * (sync.maxOpen, sync.maxNewPerSync) and gates them by the scope a person last took (scope-hold.ts). A preview counts
 * the adds already planned at earlier places as held, since it writes nothing.
 */
export function scopePlace(run: PlaceScopeRun, issues: readonly HostIssue[], planOf: (issues: readonly HostIssue[]) => SyncPlan): ScopedPlace {
  const scoped = scopeIssues(issues, run.request);
  const planned = planOf(scoped.issues);
  const open = run.active + (run.kind === 'preview' ? run.plannedAdds : 0);
  const caps = { maxOpen: run.sync.maxOpen, maxNewPerSync: Math.max(0, run.sync.maxNewPerSync - run.plannedAdds) };
  const capped = capPlan(planned, scoped.issues, run.refOf, run.request, caps, open);
  const gate = gateScope(run.kind, run.taken, scopeMark(run.request), capped.plan);
  // The adds the scope hold kept back are told by its own line, so no CAPPED line counts them as well.
  const waiting = gate.held > 0 ? addsOf(planned) : 0;
  return {
    issues: scoped.issues,
    plan: gate.plan,
    place: gate.place,
    scopeLines: scopeLines(run.target, scoped.outside, gate.held > 0 ? { ...capped, held: 0 } : capped),
    heldLines: waiting > 0 ? [`HELD ${run.target}: ${waiting} issue(s) of a new or wider import scope wait for ${KIT_NAME} issue sync --yes`] : [],
    scopeHolds: gate.tell ? [heldScopeLine(run.source, run.target, waiting, run.sync.maxNewPerSync)] : [],
  };
}

/** How many tasks `plan` adds. */
export function addsOf(plan: SyncPlan): number {
  return plan.steps.filter((step) => step.kind === 'add').length;
}

/**
 * The request a place's list reads: the team's scope with the accept label always counted (an issue a person
 * accepted is always meant for the team), no people of the core's own (the connector names the tracker's), and
 * `held`, the issue numbers the register holds active tasks for there.
 */
export function scopeRequestOf(scope: ImportScope, acceptLabel: string, held: readonly number[]): ScopeRequest {
  const labels = scope.labels.some((label) => label.toLowerCase() === acceptLabel.toLowerCase()) ? scope.labels : [...scope.labels, acceptLabel];
  return { scope: { ...scope, labels }, people: [], held };
}

/** The numbers of the issues at `target` that the `active` imported tasks hold, by their refs. */
export function heldAt(target: string, active: readonly Task[], parseRef: (ref: string) => IssueTarget | undefined): number[] {
  return active.flatMap((task) => {
    const at = task.ref === null ? undefined : parseRef(task.ref);
    return at !== undefined && at.repo === target ? [at.number] : [];
  });
}

/**
 * The lines saying what the scope and the caps kept out of a place: a SCOPE line for the issues outside the scope the
 * tracker gave, a CAPPED line for the adds the caps held back, with the key that held them.
 */
export function scopeLines(target: string, outside: number, capped: CappedPlan): string[] {
  return [
    ...(outside > 0 ? [`SCOPE ${target}: ${outside} issue(s) outside the import scope dropped; sync.scope widens it`] : []),
    ...(capped.held > 0 && capped.key !== undefined ? [`CAPPED ${target}: ${capped.held} more in scope, held for a later run; raise sync.${capped.key} or narrow sync.scope`] : []),
  ];
}
