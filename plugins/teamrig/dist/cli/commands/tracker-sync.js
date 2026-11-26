import { KIT_NAME } from "../../core/home.js";
import { SecretScanner } from "../../core/secrets.js";
import { formatScopeFile, gateScope, heldScopeLine, parseScopeFile, scopeMark } from "../../sync/scope-hold.js";
import { connectorState } from "../connector-state.js";
import { GITHUB_SOURCE, isImportSource } from "../../register/model.js";
import { addedTasks } from "../../sync/auto.js";
import { importedTasks, linkedRefs, planSync } from "../../sync/plan.js";
import { capPlan, scopeIssues } from "../../sync/scope.js";
import { formatReportersFile, insideReporters, parseReportersFile, reporterLines } from "../../sync/reporters.js";
import { ACTIVE_STATUSES } from "../../register/model.js";
import { plainLine } from "../../core/printable.js";
import { applySteps } from "../../sync/sync.js";
import { connectorOffBy, CONNECTOR_OFF } from "../connector-off.js";
import { HostAdapterError, trackerPortsOf } from "../issue-hosts.js";
import { RefusedError } from "../runtime.js";
import { previewLines, refusedReason, resultLines, SHOWN_LEFT_OUT } from "./issue-sync-lines.js";
/** The scope store in each connector's state folder (connector-state.ts). */
export function fileScopeStore(files, paths) {
    return {
        read: async (id) => parseScopeFile((await files.read(connectorState(paths, id).scope)) ?? ''),
        write: (id, places) => files.write(connectorState(paths, id).scope, formatScopeFile(places)),
    };
}
/** The reporter store in each connector's state folder (connector-state.ts). */
export function fileReporterStore(files, paths) {
    return {
        read: async (id) => parseReportersFile((await files.read(connectorState(paths, id).reporters)) ?? ''),
        write: (id, seen) => files.write(connectorState(paths, id).reporters, formatReportersFile(seen)),
    };
}
/** The end of a run that reads no other tracker, as one given `--repo` does. */
export const NO_TRACKER_SYNC = { ends: [], written: 0, added: [], failures: [], scopeHolds: [] };
/**
 * The ids of the connectors, other than GitHub, whose section the team wrote under `connectors` and whose issues the
 * register can hold as an import (register/model.ts): GitHub's import reads `github.repos` on its own.
 */
export function importConnectors(config) {
    return Object.keys(config.connectors).filter((id) => isImportSource(id) && id !== GITHUB_SOURCE);
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
export async function syncTrackers(run, say) {
    const ends = [];
    const added = [];
    const failures = [];
    const scopeHolds = [];
    let written = 0;
    const write = run.kind !== 'preview';
    const rules = { ...run.rules, owners: new Map(), repoSessions: new Map() };
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
        const tracker = { source: id, name: ports.tracker.name, refOf: ports.refs.refOf, pageOf: ports.refs.pageOf };
        const told = new Set();
        const planned = { adds: 0 };
        const taken = await run.scopes.read(id);
        const places = new Map(taken);
        const seen = await run.reporters.read(id);
        const reporters = new Set(seen);
        let wrote = 0;
        for (const target of ports.targets) {
            const end = await syncTarget(run, { ports, tracker, rules, told, planned, places, seen, reporters }, target, say);
            ends.push(end.end);
            added.push(...end.added);
            failures.push(...end.failures);
            scopeHolds.push(...end.scopeHolds);
            wrote += end.written;
        }
        if (write && formatScopeFile(places) !== formatScopeFile(taken)) {
            await run.scopes.write(id, places);
        }
        // Only a person's --yes takes a reporter, so an automatic run keeps marking a new one until someone has seen it.
        if (run.kind === 'yes' && formatReportersFile(reporters) !== formatReportersFile(seen)) {
            await run.reporters.write(id, reporters);
        }
        written += wrote;
        say(write
            ? `WROTE ${wrote} change(s) to the task list as ${id}; ${ports.tracker.name} was only read`
            : `PREVIEW nothing was written; ${KIT_NAME} issue sync --yes writes the above as ${id}`);
    }
    return { ends, written, added, failures, scopeHolds };
}
/**
 * Builds the ports of connector `id`. A section the adapter refuses, or an adapter that gives no tracker, ends only
 * that connector's import, so a wrong Jira key never stops GitHub's import in the same run.
 */
async function portsFor(run, id) {
    try {
        return { kind: 'built', ports: await trackerPortsOf(id, run.runtime, new SecretScanner(run.config.register.secretPatterns), run.config.github.stamp, run.config.connectors, run.load) };
    }
    catch (error) {
        if (error instanceof RefusedError) {
            return { kind: 'broken', end: 'refused', reason: error.message };
        }
        if (error instanceof HostAdapterError) {
            return { kind: 'broken', end: 'failed', reason: error.message };
        }
        throw error;
    }
}
async function syncTarget(run, on, target, say) {
    const failed = (reason) => {
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
    const counted = { ...request, people: read.people ?? [] };
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
    // A ruled issue's TRUST line already says why it was kept out, so the LEFT OUT line names only the others.
    const ruled = new Set(scoped.issues.filter((issue) => issue.ruled !== undefined).map((issue) => issue.number));
    const inside = insideReporters(scoped.issues);
    inside.forEach((reporter) => on.reporters.add(reporter.id));
    const leftOut = [
        ...scopeLines(target, scoped.outside, gate.held > 0 ? { ...capped, held: 0 } : capped),
        ...trustLines(target, scoped.issues, (issue) => on.tracker.refOf({ repo: target, number: issue.number })),
        ...reporterLines(target, inside, on.seen),
        ...(waiting > 0 ? [`HELD ${target}: ${waiting} issue(s) of a new or wider import scope wait for ${KIT_NAME} issue sync --yes`] : []),
        ...leftOutLine(target, plan.leftOut.filter((number) => !ruled.has(number)).flatMap((number) => on.tracker.refOf({ repo: target, number }) ?? [])),
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
function addsOf(plan) {
    return plan.steps.filter((step) => step.kind === 'add').length;
}
/**
 * The request a place's list reads: the team's scope with the accept label always counted (an issue a person
 * accepted is always meant for the team), no people of the core's own (the connector names the tracker's), and
 * `held`, the issue numbers the register holds active tasks for there.
 */
export function scopeRequestOf(scope, acceptLabel, held) {
    const labels = scope.labels.some((label) => label.toLowerCase() === acceptLabel.toLowerCase()) ? scope.labels : [...scope.labels, acceptLabel];
    return { scope: { ...scope, labels }, people: [], held };
}
/** The numbers of the issues at `target` that the `active` imported tasks hold, by their refs. */
export function heldAt(target, active, parseRef) {
    return active.flatMap((task) => {
        const at = task.ref === null ? undefined : parseRef(task.ref);
        return at !== undefined && at.repo === target ? [at.number] : [];
    });
}
/**
 * The lines saying what the scope and the caps kept out of a place: a SCOPE line for the issues outside the scope the
 * tracker gave, a CAPPED line for the adds the caps held back, with the key that held them.
 */
export function scopeLines(target, outside, capped) {
    return [
        ...(outside > 0 ? [`SCOPE ${target}: ${outside} issue(s) outside the import scope dropped; sync.scope widens it`] : []),
        ...(capped.held > 0 && capped.key !== undefined ? [`CAPPED ${target}: ${capped.held} more in scope, held for a later run; raise sync.${capped.key} or narrow sync.scope`] : []),
    ];
}
/**
 * Why the tracker's own trust rule (sync/trust-rule.ts) let in or kept out each open issue of a place, one TRUST line
 * per verdict and block, by ref only (the text is the issue's, never shown here), at most SHOWN_LEFT_OUT refs a line,
 * then how many more; lines that let in come first. A verdict whose fact could not be read says so. An issue judged by
 * its authors' ties (no `ruled`) gets no line: the LEFT OUT line tells those.
 */
export function trustLines(target, issues, refOf) {
    const groups = new Map();
    for (const issue of issues) {
        const ref = refOf(issue);
        if (issue.state !== 'open' || issue.ruled === undefined || ref === undefined) {
            continue;
        }
        const { ruled } = issue;
        const key = ruled.trusted ? `let in, ${plainLine(ruled.why)}` : `kept out, ${plainLine(ruled.why)}${ruled.failed === undefined ? '' : ` (${plainLine(ruled.failed)})`}`;
        groups.set(key, [...(groups.get(key) ?? []), ref]);
    }
    return [...groups]
        .sort(([a], [b]) => Number(b.startsWith('let in')) - Number(a.startsWith('let in')))
        .map(([why, refs]) => {
        const more = refs.length - SHOWN_LEFT_OUT;
        return `TRUST ${target}: ${refs.length} ${why}: ${refs.slice(0, SHOWN_LEFT_OUT).join(' ')}${more > 0 ? ` and ${more} more` : ''}`;
    });
}
/**
 * The line naming, by ref only, the open issues of a place the trust rule (sync/trust.ts) kept out: at most
 * SHOWN_LEFT_OUT, then how many more; none when it kept none out.
 */
function leftOutLine(target, refs) {
    if (refs.length === 0) {
        return [];
    }
    const more = refs.length - SHOWN_LEFT_OUT;
    return [`LEFT OUT ${target}: ${refs.length} open issue(s) the trust rule kept out: ${refs.slice(0, SHOWN_LEFT_OUT).join(' ')}${more > 0 ? ` and ${more} more` : ''}`];
}
