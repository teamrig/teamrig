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
 * which program it runs, and with which arguments, is the adapter's own rule to keep. Both ports are asked of every adapter, as every command here was written for a
 * host that is both; a tracker with no code host needs its commands to ask for the tracker alone first.
 */
export async function hostsOf(kind, runtime, scanner, stamp, sections, load = loadConnector) {
    const loaded = await load(kind);
    if (loaded.kind === 'refused') {
        throw new HostAdapterError(kind, loaded.notices);
    }
    const problems = [];
    const build = loaded.value.configure(sectionOf(sections, kind), (key, problem) => problems.push(`connectors.${kind}.${key} ${problem}`));
    if (problems.length > 0) {
        throw new RefusedError(problems.join('; '));
    }
    const { tracker, codeHost } = build({
        run: runtime.run,
        http: runtime.http,
        credentials: runtime.credentials,
        env: runtime.env,
        scanner,
        stamp,
    });
    if (tracker === undefined || codeHost === undefined) {
        throw new HostAdapterError(kind, [...(tracker === undefined ? ['it builds no tracker'] : []), ...(codeHost === undefined ? ['it builds no code host'] : [])]);
    }
    return { tracker, codeHost };
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
