import { loadConnector } from "../composition/loader.js";
import { RefusedError } from "./runtime.js";
/**
 * A connector's section of the team's map: the one written under its id, else an empty one, which the connector reads
 * as its defaults. Only a section the team wrote counts, as an id may be a word every object answers to, such as
 * `constructor`.
 */
export function sectionOf(sections, id) {
    return (Object.hasOwn(sections, id) ? sections[id] : undefined) ?? {};
}
/**
 * A host's connector adapter gave no host. The adapters ship with teamrig, so this is teamrig's own fault and never
 * something the caller asked wrongly: it ends the command as a failure, not a refusal.
 */
export class HostAdapterError extends Error {
    name = 'HostAdapterError';
    constructor(kind, reasons) {
        super(`the ${kind} connector adapter gave no host: ${reasons.join('; ')}`);
    }
}
/**
 * The tracker and the code host of a host kind (issues/host.ts), built by the connector adapter whose id the kind
 * is: the one place the CLI reaches a host's code, and it names none. A command asks once per run and keeps the
 * answer, so the run reads each owner's saved key once. `stamp` is the team's github.stamp: whether each text posted
 * ends with the made-with-teamrig footer. `sections` is the team's `connectors` map: the adapter reads and checks the
 * section under its own id, an empty one (its defaults) when the team wrote none, and a key it refuses ends the command
 * as a refusal naming the key's path in the team config.
 *
 * The adapter is handed the run's program runner as it is, held to the two connector limits (plugin-api/connector.ts);
 * which program it runs, and with which arguments, is the adapter's own rule to keep. Both ports are asked of the
 * adapter: a command that only reads or writes issues asks trackerOf instead, so a tracker with no code host serves it.
 */
export async function hostsOf(kind, runtime, scanner, stamp, sections, load = loadConnector) {
    const { tracker, codeHost } = await portsOf(kind, runtime, scanner, stamp, sections, load);
    if (tracker === undefined || codeHost === undefined) {
        throw new HostAdapterError(kind, [...(tracker === undefined ? ['it builds no tracker'] : []), ...(codeHost === undefined ? ['it builds no code host'] : [])]);
    }
    return { tracker, codeHost };
}
/**
 * The tracker alone of the connector `id`, built as hostsOf builds both ports: for a command that only reads or writes
 * issues, so a connector that is a tracker and no code host (Jira) serves it. An adapter that builds no tracker fails
 * the command, as for hostsOf.
 */
export async function trackerOf(id, runtime, scanner, stamp, sections, load = loadConnector) {
    const { tracker } = await portsOf(id, runtime, scanner, stamp, sections, load);
    if (tracker === undefined) {
        throw new HostAdapterError(id, ['it builds no tracker']);
    }
    return tracker;
}
/**
 * The tracker of the connector `id` with the places its section names and its issue refs, built as trackerOf builds
 * the tracker: for the import of a tracker whose refs and places core does not know (Jira). An adapter that builds no
 * tracker or gives no refs fails the command, as for hostsOf; one that names no place gives an empty list.
 */
export async function trackerPortsOf(id, runtime, scanner, stamp, sections, load = loadConnector) {
    const { tracker, targets, refs } = await portsOf(id, runtime, scanner, stamp, sections, load);
    if (tracker === undefined || refs === undefined) {
        throw new HostAdapterError(id, [...(tracker === undefined ? ['it builds no tracker'] : []), ...(refs === undefined ? ['it gives no issue refs'] : [])]);
    }
    return { tracker, targets: targets ?? [], refs };
}
/** The ports the adapter of `id` builds from its section of the team config, the shared step of hostsOf, trackerOf and trackerPortsOf. */
async function portsOf(id, runtime, scanner, stamp, sections, load) {
    const loaded = await load(id);
    if (loaded.kind === 'refused') {
        throw new HostAdapterError(id, loaded.notices);
    }
    const problems = [];
    const build = loaded.value.configure(sectionOf(sections, id), (key, problem) => problems.push(`connectors.${id}.${key} ${problem}`));
    if (problems.length > 0) {
        throw new RefusedError(problems.join('; '));
    }
    return build({
        run: runtime.run,
        http: runtime.http,
        credentials: runtime.credentials,
        env: runtime.env,
        scanner,
        stamp,
    });
}
/** The repositories to read: every one of `github.repos`, or the one `--repo` names, which must be among them. */
export function reposOf(repos, asked) {
    if (asked === undefined) {
        return repos;
    }
    const repo = asked.trim().toLowerCase();
    if (!repos.includes(repo)) {
        throw new RefusedError(`--repo ${asked} is not one of github.repos (${repos.join(', ')})`);
    }
    return [repo];
}
