import { printable } from "../core/printable.js";
const KIND_ORDER = ['action', 'behaviour', 'feature', 'fix', 'other'];
/** `1.2.3` against `1.10.0`, by number; a pre-release (`1.2.3-rc.1`) comes before its release. */
export function compareVersions(a, b) {
    const [aCore = '', aPre] = a.split('-', 2);
    const [bCore = '', bPre] = b.split('-', 2);
    const aParts = aCore.split('.').map(Number);
    const bParts = bCore.split('.').map(Number);
    for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
        const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    if (aPre === bPre) {
        return 0;
    }
    return aPre === undefined ? 1 : bPre === undefined ? -1 : aPre.localeCompare(bPre);
}
/**
 * A typed `--since` or `--until`: a version (`0.447.0`, `v0.447.0`), else a time `instantOf` reads, which knows the
 * reader's zone; kept as an ISO time, so every source compares it alike.
 */
export function parsePoint(text, instantOf) {
    const version = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/.exec(text.trim())?.[1];
    if (version !== undefined) {
        return { kind: 'version', version };
    }
    const at = instantOf(text.trim());
    return at === undefined ? undefined : { kind: 'date', at: at.toISOString() };
}
/** A point by the release index: a version is its release's commit and time; a time has no version or commit. */
function resolve(point, releases) {
    if (point.kind === 'date') {
        return { version: undefined, at: point.at, ref: undefined };
    }
    const release = releases.find((candidate) => candidate.version === point.version);
    return release === undefined
        ? { kind: 'unknown-version', version: point.version, known: releases.map((known) => known.version) }
        : { version: release.version, at: release.at, ref: release.sha };
}
/** The release an entry shipped in, by its time: the oldest release made at or after it; none when it is newer than every one. */
function versionByTime(at, oldestFirst) {
    return at === undefined ? undefined : oldestFirst.find((release) => release.at >= at)?.version;
}
/** Whether an entry is past `since` and up to `until`, by version where both have one, else by time; an entry with neither is kept. */
function inRange(entry, since, until) {
    const after = entry.version !== undefined && since.version !== undefined ? compareVersions(entry.version, since.version) > 0 : entry.at === undefined || since.at === undefined || entry.at > since.at;
    if (!after || until === undefined) {
        return after;
    }
    if (until.version !== undefined) {
        return entry.version !== undefined ? compareVersions(entry.version, until.version) <= 0 : entry.at !== undefined && until.at !== undefined && entry.at <= until.at;
    }
    return entry.at === undefined || until.at === undefined || entry.at <= until.at;
}
function touches(entry, file) {
    const path = file.replace(/\\/g, '/').replace(/^\.\//, '');
    return entry.files.some((touched) => touched === path || touched.startsWith(path.endsWith('/') ? path : `${path}/`));
}
/** Entries from earlier sources win: a later entry whose every ref an earlier one already names (the same commit, the same task) is the same change. */
function withoutRepeats(bySource) {
    const named = new Set();
    const kept = [];
    for (const entries of bySource) {
        const fresh = entries.filter((entry) => entry.refs.length === 0 || !entry.refs.every((ref) => named.has(ref)));
        kept.push(...fresh);
        for (const entry of fresh) {
            for (const ref of entry.refs) {
                named.add(ref);
            }
        }
    }
    return kept;
}
/**
 * An entry as it may be shown: a commit subject, a note or a release's text comes from whoever wrote it, an outside
 * contributor too, so every control character and bidi mark in it is escaped (core/printable.ts), and it cannot send
 * escape sequences to the reader's terminal nor add lines of its own. The text keeps its own lines, each escaped.
 */
function shownEntry(entry) {
    return {
        ...entry,
        area: printable(entry.area),
        text: entry.text.split('\n').map(printable).join('\n'),
        action: entry.action === undefined ? undefined : printable(entry.action),
        files: entry.files.map(printable),
        refs: entry.refs.map(printable),
    };
}
function byShowOrder(a, b) {
    if (a.version !== b.version) {
        return a.version === undefined ? -1 : b.version === undefined ? 1 : compareVersions(b.version, a.version);
    }
    const kind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (kind !== 0) {
        return kind;
    }
    return a.area.localeCompare(b.area) || (b.at ?? '').localeCompare(a.at ?? '');
}
/** The sources the ask picks: every one that applies to the project under `auto`, else the named ones, which must exist. */
async function picked(deps, registry, sources) {
    if (sources === 'auto') {
        const applies = await Promise.all(registry.map((source) => source.detect(deps).catch(() => false)));
        return registry.filter((_, index) => applies[index] === true);
    }
    const chosen = [];
    for (const id of sources) {
        const source = registry.find((candidate) => candidate.id === id);
        if (source === undefined) {
            return { kind: 'unknown-source', source: id, known: registry.map((known) => known.id) };
        }
        chosen.push(source);
    }
    return chosen;
}
/**
 * What changed in the project in the asked range: each picked source read with the range resolved by the release
 * index, its entries given the version they shipped in, narrowed to `file` and `area`, the same change named by two
 * sources kept once (the earlier source's), in show order. A failed source is reported beside the others' entries.
 */
export async function readChanges(deps, registry, ask) {
    const sources = await picked(deps, registry, ask.sources);
    if (!Array.isArray(sources)) {
        return sources;
    }
    const releases = await deps.git.releases(deps.project).catch(() => []);
    const since = resolve(ask.since, releases);
    if ('kind' in since) {
        return since;
    }
    const until = ask.until === undefined ? undefined : resolve(ask.until, releases);
    if (until !== undefined && 'kind' in until) {
        return until;
    }
    const area = ask.area?.toLowerCase();
    const reads = await Promise.all(sources.map(async (source) => {
        const query = { since, until, file: source.capabilities.byFile ? ask.file : undefined, area: source.capabilities.byArea ? area : undefined };
        return { source, read: await source.read(deps, query).catch((error) => ({ kind: 'failed', error: error instanceof Error ? error.message : String(error) })) };
    }));
    const oldestFirst = [...releases].reverse();
    const bySource = reads.map(({ read }) => read.kind === 'read'
        ? read.entries
            .map((entry) => (entry.version === undefined ? { ...entry, version: versionByTime(entry.at, oldestFirst) } : entry))
            .filter((entry) => inRange(entry, since, until))
            .filter((entry) => ask.file === undefined || touches(entry, ask.file))
            .filter((entry) => area === undefined || entry.area === area)
        : []);
    return {
        kind: 'report',
        since,
        until,
        read: sources.map((source) => source.id),
        entries: withoutRepeats(bySource).map(shownEntry).sort(byShowOrder),
        warnings: reads.flatMap(({ source, read }) => (read.kind === 'read' ? read.warnings.map((warning) => `${source.id}: ${printable(warning)}`) : [])),
        failed: reads.flatMap(({ source, read }) => (read.kind === 'failed' ? [{ source: source.id, error: printable(read.error) }] : [])),
        releases,
    };
}
