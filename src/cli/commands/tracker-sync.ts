import type { Files } from '../../core/files.ts';
import { KIT_NAME, type TeamPaths } from '../../core/home.ts';
import { SecretScanner } from '../../core/secrets.ts';
import { formatScopeFile, gateScope, heldScopeLine, parseScopeFile, scopeMark, type PlaceScope, type ScopeRunKind } from '../../sync/scope-hold.ts';
import { connectorState } from '../connector-state.ts';
import type { KitConfig } from '../../config/types.ts';
import type { Register } from '../../register/register.ts';
import { GITHUB_SOURCE, isImportSource, type ImportSource } from '../../register/model.ts';
import { addedTasks, type AddedTask, type RepoFailure } from '../../sync/auto.ts';
import type { ImportRules, ImportTracker } from '../../sync/map.ts';
import { importedTasks, linkedRefs, planSync, type SyncPlan } from '../../sync/plan.ts';
import { capPlan, scopeIssues, type CappedPlan, type ImportScope, type ScopeRequest } from '../../sync/scope.ts';
import { ACTIVE_STATUSES } from '../../register/model.ts';
import type { Task } from '../../register/fold.ts';
import type { IssueTarget } from '../../issues/host.ts';
import { applySteps, type ImportWriter } from '../../sync/sync.ts';
import { connectorOffBy, CONNECTOR_OFF } from '../connector-off.ts';
import { HostAdapterError, trackerPortsOf, type ConnectorLoader, type HostRuntime, type TrackerPorts } from '../issue-hosts.ts';
import { RefusedError } from '../runtime.ts';
import { previewLines, refusedReason, resultLines, SHOWN_LEFT_OUT, type RepoEnd } from './issue-sync-lines.ts';

/** The register as the import of another tracker reads and writes it. */
export type TrackerRegister = ImportWriter & Pick<Register, 'snapshot'>;

/** What one run of the import of the team's other trackers reads, and where it writes. */
export interface TrackerSyncRun {
  readonly runtime: HostRuntime;
  readonly config: KitConfig;
  readonly register: TrackerRegister;
  /** The import's rules for GitHub (map.ts); the GitHub-only keys are dropped before another tracker reads them. */
  readonly rules: ImportRules;
  /** The oldest close a list still reads (closedSince). */
  readonly since: string;
  /** A preview writes nothing; `yes` and `auto` write, and only `auto` holds a new or wider scope's adds (scope-hold.ts). */
  readonly kind: ScopeRunKind;
  /** Where each connector's places' taken scopes are kept. */
  readonly scopes: ScopeStore;
  /** Builds a connector's ports; the adapters teamrig ships unless a test gives its own. */
  readonly load?: ConnectorLoader;
}

/** Where the import keeps, per connector, the scope each place last took (scope-hold.ts). */
export interface ScopeStore {
  read(id: ImportSource): Promise<ReadonlyMap<string, PlaceScope>>;
  write(id: ImportSource, places: ReadonlyMap<string, PlaceScope>): Promise<void>;
}

/** The scope store in each connector's state folder (connector-state.ts). */
export function fileScopeStore(files: Pick<Files, 'read' | 'write'>, paths: TeamPaths): ScopeStore {
  return {
    read: async (id) => parseScopeFile((await files.read(connectorState(paths, id).scope)) ?? ''),
    write: (id, places) => files.write(connectorState(paths, id).scope, formatScopeFile(places)),
  };
}

/**
 * How the import of the other trackers ended: each place's end, the writes made, the tasks it added, the places that
 * failed, and the lines for the lead about places whose adds an automatic run held for a new or wider scope.
 */
export interface TrackerSyncEnd {
  readonly ends: readonly RepoEnd[];
  readonly written: number;
  readonly added: readonly AddedTask[];
  readonly failures: readonly RepoFailure[];
  readonly scopeHolds: readonly string[];
}

/** The end of a run that reads no other tracker, as one given `--repo` does. */
export const NO_TRACKER_SYNC: TrackerSyncEnd = { ends: [], written: 0, added: [], failures: [], scopeHolds: [] };

/**
 * The ids of the connectors, other than GitHub, whose section the team wrote under `connectors` and whose issues the
 * register can hold as an import (register/model.ts): GitHub's import reads `github.repos` on its own.
 */
export function importConnectors(config: Pick<KitConfig, 'connectors'>): readonly ImportSource[] {
  return Object.keys(config.connectors).filter((id): id is ImportSource => isImportSource(id) && id !== GITHUB_SOURCE);
}

/**
 * The inbound half of `issue sync` for every tracker other than GitHub (importConnectors): for each place its section
 * names (ConnectorPorts.targets), it lists the issues, plans the writes as GitHub's import does (sync/plan.ts) and,
 * unless the run is a preview, writes them as the connector's source; an automatic run adds nothing at a place whose
 * scope is new or wider than a person last took with `--yes`, and gives the lead a line (scope-hold.ts). It reads no pull requests, mentions or security issues, and
 * pushes nothing: those are a code host's, or GitHub's alone. An issue is routed by the team's area labels, else to
 * the lead: `github.owners` and the sessions of `github.repos` name GitHub logins and repositories, never another
 * tracker's people or places. `TEAMRIG_CONNECTOR_<ID>=off` turns one connector's import off on this machine.
 */
export async function syncTrackers(run: TrackerSyncRun, say: (line: string) => void): Promise<TrackerSyncEnd> {
  const ends: RepoEnd[] = [];
  const added: AddedTask[] = [];
  const failures: RepoFailure[] = [];
  const scopeHolds: string[] = [];
  let written = 0;
  const write = run.kind !== 'preview';
  const rules: ImportRules = { ...run.rules, owners: new Map(), repoSessions: new Map() };
  for (const id of importConnectors(run.config)) {
    const offBy = connectorOffBy(run.runtime.env, id);
    if (offBy !== undefined) {
      say(`OFF ${offBy}=${CONNECTOR_OFF} turns the ${id} import off on this machine; nothing of it was read or written`);
      continue;
    }
    const built = await portsFor(run, id);
    if (built.kind === 'broken') {
      say(`${built.end === 'refused' ? 'REFUSED' : 'FAILED'} the ${id} import: ${built.reason}; nothing of it was read or written`);
      ends.push(built.end);
      failures.push({ repo: id, reason: built.reason });
      continue;
    }
    const { ports } = built;
    if (ports.targets.length === 0) {
      say(`OFF connectors.${id} names no place to read; nothing of it was read or written`);
      continue;
    }
    const tracker: ImportTracker = { source: id, name: ports.tracker.name, refOf: ports.refs.refOf, pageOf: ports.refs.pageOf };
    const told = new Set<string>();
    const planned = { adds: 0 };
    const taken = await run.scopes.read(id);
    const places = new Map(taken);
    let wrote = 0;
    for (const target of ports.targets) {
      const end = await syncTarget(run, { ports, tracker, rules, told, planned, places }, target, say);
      ends.push(end.end);
      added.push(...end.added);
      failures.push(...end.failures);
      scopeHolds.push(...end.scopeHolds);
      wrote += end.written;
    }
    if (write && formatScopeFile(places) !== formatScopeFile(taken)) {
      await run.scopes.write(id, places);
    }
    written += wrote;
    say(
      write
        ? `WROTE ${wrote} change(s) to the task list as ${id}; ${ports.tracker.name} was only read`
        : `PREVIEW nothing was written; ${KIT_NAME} issue sync --yes writes the above as ${id}`,
    );
  }
  return { ends, written, added, failures, scopeHolds };
}

/** A connector's ports, or why they could not be built: a key of its section refused, or an adapter that gave no tracker. */
type BuiltPorts = { readonly kind: 'built'; readonly ports: TrackerPorts } | { readonly kind: 'broken'; readonly end: 'refused' | 'failed'; readonly reason: string };

/**
 * Builds the ports of connector `id`. A section the adapter refuses, or an adapter that gives no tracker, ends only
 * that connector's import, so a wrong Jira key never stops GitHub's import in the same run.
 */
async function portsFor(run: TrackerSyncRun, id: ImportSource): Promise<BuiltPorts> {
  try {
    return { kind: 'built', ports: await trackerPortsOf(id, run.runtime, new SecretScanner(run.config.register.secretPatterns), run.config.github.stamp, run.config.connectors, run.load) };
  } catch (error) {
    if (error instanceof RefusedError) {
      return { kind: 'broken', end: 'refused', reason: error.message };
    }
    if (error instanceof HostAdapterError) {
      return { kind: 'broken', end: 'failed', reason: error.message };
    }
    throw error;
  }
}

/** What one connector's places share in a run: its ports, its import, the rules and the accesses already told. */
interface TrackerRun {
  readonly ports: TrackerPorts;
  readonly tracker: ImportTracker;
  readonly rules: ImportRules;
  readonly told: Set<string>;
  /** The adds this run planned so far across the connector's places, which the caps count (sync.maxNewPerSync). */
  readonly planned: { adds: number };
  /** The scope each place took, as this run leaves it (scope-hold.ts). */
  readonly places: Map<string, PlaceScope>;
}

/** How one place's import ended, and what it wrote. */
interface TargetEnd {
  readonly end: RepoEnd;
  readonly written: number;
  readonly added: readonly AddedTask[];
  readonly failures: readonly RepoFailure[];
  readonly scopeHolds: readonly string[];
}

async function syncTarget(run: TrackerSyncRun, on: TrackerRun, target: string, say: (line: string) => void): Promise<TargetEnd> {
  const failed = (reason: string): TargetEnd => {
    say(`FAILED ${target}: ${reason}; its tasks stay as they are`);
    return { end: 'failed', written: 0, added: [], failures: [{ repo: target, reason }], scopeHolds: [] };
  };
  const reach = await on.ports.tracker.reach(target, 'read');
  if (reach.kind === 'unreachable') {
    return failed(reach.reason);
  }
  if (!on.told.has(reach.scope)) {
    on.told.add(reach.scope);
    say(`ACCESS ${reach.access}`);
  }
  const tasks = [...(await run.register.snapshot()).state.tasks.values()];
  const imported = importedTasks(tasks, on.tracker.source);
  const active = [...imported.values()].filter((task) => ACTIVE_STATUSES.includes(task.status));
  const request = scopeRequestOf(run.config.sync.scope, on.rules.acceptLabel, heldAt(target, active, on.ports.refs.parseRef));
  const read = await on.ports.tracker.list(target, run.since, request);
  if (read.kind === 'failed') {
    return failed(read.reason);
  }
  read.notes.forEach((note) => say(`NOTE ${target}: ${note}`));
  const counted: ScopeRequest = { ...request, people: read.people ?? [] };
  const scoped = scopeIssues(read.issues, counted);
  const planned = planSync(scoped.issues, imported, on.rules, on.tracker, linkedRefs(tasks));
  // A preview writes nothing, so the adds this run already planned at earlier places count as held here.
  const open = active.length + (run.kind === 'preview' ? on.planned.adds : 0);
  const caps = { maxOpen: run.config.sync.maxOpen, maxNewPerSync: Math.max(0, run.config.sync.maxNewPerSync - on.planned.adds) };
  const capped = capPlan(planned, scoped.issues, (issue) => on.tracker.refOf({ repo: target, number: issue.number }), counted, caps, open);
  const gate = gateScope(run.kind, on.places.get(target), scopeMark(counted), capped.plan);
  if (gate.place !== undefined) {
    on.places.set(target, gate.place);
  }
  const plan = gate.plan;
  on.planned.adds += plan.steps.filter((step) => step.kind === 'add').length;
  // The adds the scope hold kept back are told by its own line, so no CAPPED line counts them as well.
  const waiting = gate.held > 0 ? addsOf(planned) : 0;
  const leftOut = [
    ...scopeLines(target, scoped.outside, gate.held > 0 ? { ...capped, held: 0 } : capped),
    ...(waiting > 0 ? [`HELD ${target}: ${waiting} issue(s) of a new or wider import scope wait for ${KIT_NAME} issue sync --yes`] : []),
    ...leftOutLine(target, plan.leftOut.flatMap((number) => on.tracker.refOf({ repo: target, number }) ?? [])),
  ];
  const scopeHolds = gate.tell ? [heldScopeLine(on.tracker.source, target, waiting, run.config.sync.maxNewPerSync)] : [];
  if (run.kind === 'preview') {
    [...previewLines(target, plan), ...leftOut].forEach(say);
    return { end: 'ok', written: 0, added: [], failures: [], scopeHolds };
  }
  const outcomes = await applySteps(run.register, on.tracker.source, plan.steps);
  [...resultLines(target, plan, outcomes), ...leftOut].forEach(say);
  const refused = refusedReason(outcomes);
  return {
    end: refused === undefined ? 'ok' : 'refused',
    written: outcomes.filter((outcome) => outcome.result.ok).length,
    added: addedTasks(outcomes),
    failures: refused === undefined ? [] : [{ repo: target, reason: refused }],
    scopeHolds,
  };
}

/** How many tasks `plan` adds. */
function addsOf(plan: SyncPlan): number {
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

/**
 * The line naming, by ref only, the open issues of a place the trust rule (sync/trust.ts) kept out: at most
 * SHOWN_LEFT_OUT, then how many more; none when it kept none out.
 */
function leftOutLine(target: string, refs: readonly string[]): string[] {
  if (refs.length === 0) {
    return [];
  }
  const more = refs.length - SHOWN_LEFT_OUT;
  return [`LEFT OUT ${target}: ${refs.length} open issue(s) the trust rule kept out: ${refs.slice(0, SHOWN_LEFT_OUT).join(' ')}${more > 0 ? ` and ${more} more` : ''}`];
}
