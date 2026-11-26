import { isRecord } from "../core/guards.js";
import { plainLine } from "../core/printable.js";
/** The version of the reporters file; a file of another reads as no reporter seen. */
export const REPORTERS_FILE_FORMAT = 1;
/**
 * The reporters of the open issues at a place that the tracker's own trust rule let in (`ruled.trusted`), with how
 * many each reported, most first, then by id. An issue judged by its authors' ties (no `ruled`) or with no reporter
 * id counts for none. One account behind many issues, a shared mailbox say, then shows before anything comes in.
 */
export function insideReporters(issues) {
    const found = new Map();
    for (const issue of issues) {
        if (issue.state !== 'open' || issue.ruled?.trusted !== true || issue.author === '') {
            continue;
        }
        const seen = found.get(issue.author);
        found.set(issue.author, { id: issue.author, name: seen?.name ?? issue.authorName, count: (seen?.count ?? 0) + 1 });
    }
    return [...found.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
/**
 * One REPORTER line per inside reporter of a place: its id, its name made one plain line, its count, and NEW when no
 * `--yes` before saw it (`seen`), so a new account letting text in is plain before each import.
 */
export function reporterLines(target, reporters, seen) {
    return reporters.map((reporter) => {
        const name = reporter.name === '' ? 'no name given' : plainLine(reporter.name);
        return `REPORTER ${target}: ${plainLine(reporter.id)} (${name}) let in ${reporter.count} issue(s)${seen.has(reporter.id) ? '' : ', NEW since the last --yes'}`;
    });
}
/**
 * The reporter ids `text` holds. A file that is not one, or of another format, reads as none, so every reporter is
 * marked new again: a lost file hides no one.
 */
export function parseReportersFile(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return new Set();
    }
    const ids = isRecord(parsed) && parsed['format'] === REPORTERS_FILE_FORMAT ? parsed['seen'] : undefined;
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
}
/** The file of the reporter ids `seen`, sorted, read back by parseReportersFile. */
export function formatReportersFile(seen) {
    return `${JSON.stringify({ format: REPORTERS_FILE_FORMAT, seen: [...seen].sort() }, null, 2)}\n`;
}
