import { KIT_NAME } from '../../core/home.ts';
import { SecretScanner } from '../../core/secrets.ts';
import type { KitConfig } from '../../config/types.ts';
import type { Register } from '../../register/register.ts';
import { GITHUB_SOURCE, isImportSource, type ImportSource } from '../../register/model.ts';
import { addedTasks, type AddedTask, type RepoFailure } from '../../sync/auto.ts';
import type { ImportRules, ImportTracker } from '../../sync/map.ts';
import { importedTasks, linkedRefs, planSync } from '../../sync/plan.ts';
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
  readonly write: boolean;
  /** Builds a connector's ports; the adapters teamrig ships unless a test gives its own. */
  readonly load?: ConnectorLoader;
}

/** How the import of the other trackers ended: each place's end, the writes made, the tasks it added and the places that failed. */
export interface TrackerSyncEnd {
  readonly ends: readonly RepoEnd[];
  readonly written: number;
  readonly added: readonly AddedTask[];
  readonly failures: readonly RepoFailure[];
}

/** The end of a run that reads no other tracker, as one given `--repo` does. */
export const NO_TRACKER_SYNC: TrackerSyncEnd = { ends: [], written: 0, added: [], failures: [] };

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
 * with `write`, writes them as the connector's source. It reads no pull requests, mentions or security issues, and
 * pushes nothing: those are a code host's, or GitHub's alone. An issue is routed by the team's area labels, else to
 * the lead: `github.owners` and the sessions of `github.repos` name GitHub logins and repositories, never another
 * tracker's people or places. `TEAMRIG_CONNECTOR_<ID>=off` turns one connector's import off on this machine.
 */
export async function syncTrackers(run: TrackerSyncRun, say: (line: string) => void): Promise<TrackerSyncEnd> {
  const ends: RepoEnd[] = [];
  const added: AddedTask[] = [];
  const failures: RepoFailure[] = [];
  let written = 0;
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
    let wrote = 0;
    for (const target of ports.targets) {
      const end = await syncTarget(run, { ports, tracker, rules, told }, target, say);
      ends.push(end.end);
      added.push(...end.added);
      failures.push(...end.failures);
      wrote += end.written;
    }
    written += wrote;
    say(
      run.write
        ? `WROTE ${wrote} change(s) to the task list as ${id}; ${ports.tracker.name} was only read`
        : `PREVIEW nothing was written; ${KIT_NAME} issue sync --yes writes the above as ${id}`,
    );
  }
  return { ends, written, added, failures };
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
}

/** How one place's import ended, and what it wrote. */
interface TargetEnd {
  readonly end: RepoEnd;
  readonly written: number;
  readonly added: readonly AddedTask[];
  readonly failures: readonly RepoFailure[];
}

async function syncTarget(run: TrackerSyncRun, on: TrackerRun, target: string, say: (line: string) => void): Promise<TargetEnd> {
  const failed = (reason: string): TargetEnd => {
    say(`FAILED ${target}: ${reason}; its tasks stay as they are`);
    return { end: 'failed', written: 0, added: [], failures: [{ repo: target, reason }] };
  };
  const reach = await on.ports.tracker.reach(target, 'read');
  if (reach.kind === 'unreachable') {
    return failed(reach.reason);
  }
  if (!on.told.has(reach.scope)) {
    on.told.add(reach.scope);
    say(`ACCESS ${reach.access}`);
  }
  const read = await on.ports.tracker.list(target, run.since);
  if (read.kind === 'failed') {
    return failed(read.reason);
  }
  read.notes.forEach((note) => say(`NOTE ${target}: ${note}`));
  const tasks = [...(await run.register.snapshot()).state.tasks.values()];
  const plan = planSync(read.issues, importedTasks(tasks, on.tracker.source), on.rules, on.tracker, linkedRefs(tasks));
  const leftOut = leftOutLine(target, plan.leftOut.flatMap((number) => on.tracker.refOf({ repo: target, number }) ?? []));
  if (!run.write) {
    [...previewLines(target, plan), ...leftOut].forEach(say);
    return { end: 'ok', written: 0, added: [], failures: [] };
  }
  const outcomes = await applySteps(run.register, on.tracker.source, plan.steps);
  [...resultLines(target, plan, outcomes), ...leftOut].forEach(say);
  const refused = refusedReason(outcomes);
  return {
    end: refused === undefined ? 'ok' : 'refused',
    written: outcomes.filter((outcome) => outcome.result.ok).length,
    added: addedTasks(outcomes),
    failures: refused === undefined ? [] : [{ repo: target, reason: refused }],
  };
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
