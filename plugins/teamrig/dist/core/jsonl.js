import { isNonNegativeInteger, isRecord } from "./guards.js";
/** The field every record written by this kit carries; a record without it is version 0. */
export const VERSION_FIELD = 'v';
/** Parses an append-only JSONL log. Blank lines are ignored; a damaged line is counted, never thrown. */
export function parseJsonl(text) {
    const records = [];
    let unreadable = 0;
    text.split('\n').forEach((line, index) => {
        const raw = line.endsWith('\r') ? line.slice(0, -1) : line;
        if (raw.trim() === '') {
            return;
        }
        const record = parseObject(raw);
        const version = record === undefined ? undefined : recordVersion(record);
        if (record === undefined || version === undefined) {
            unreadable += 1;
            return;
        }
        records.push({ lineNumber: index + 1, raw, record, version });
    });
    return { records, unreadable };
}
/** The record's format version: 0 when the field is absent, undefined when it is present but invalid. */
export function recordVersion(record) {
    const version = record[VERSION_FIELD];
    if (version === undefined) {
        return 0;
    }
    return isNonNegativeInteger(version) ? version : undefined;
}
/** One whole JSONL line. JSON.stringify escapes newlines inside strings, so the line never splits. */
export function toJsonlLine(record) {
    return `${JSON.stringify(record)}\n`;
}
/**
 * Appends whole JSONL lines (each ending in a newline) so the first starts a line of its own. A last line a writer
 * left without its newline, torn mid-record or whole, would otherwise swallow the first new line, losing a record
 * the caller was told is written: it gets its newline first, so its bytes stay, as one unreadable line or its own
 * record. Reads only the file's last byte (a newline is one byte in UTF-8, never part of another character), so a
 * long log costs no more; call it under the log's writer lock, which keeps another append from landing in between.
 * Nothing to append writes nothing.
 */
export async function appendJsonlLines(files, path, lines) {
    if (lines === '') {
        return;
    }
    const last = await files.readTail(path, 1);
    const separator = last === undefined || last === '' || last === '\n' ? '' : '\n';
    await files.append(path, `${separator}${lines}`);
}
/** One line as a JSON object; undefined for anything else, a damaged or torn line included. */
export function parseObject(raw) {
    try {
        const value = JSON.parse(raw);
        return isRecord(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/** Thrown before a write when the log already holds records newer than this code understands. */
export class NewerDataError extends Error {
    file;
    found;
    known;
    constructor(file, found, known) {
        super(`${file} holds format v${found} records; this version writes v${known}. A newer teamrig wrote them: reload the plugins in your session to load the installed one, or update teamrig before writing.`);
        this.name = 'NewerDataError';
        this.file = file;
        this.found = found;
        this.known = known;
    }
}
/** Refuses a write beside records this code cannot interpret, so an old binary never mixes formats. */
export function assertWritable(file, parse, knownVersion) {
    const newest = parse.records.reduce((max, record) => Math.max(max, record.version), 0);
    if (newest > knownVersion) {
        throw new NewerDataError(file, newest, knownVersion);
    }
}
/**
 * A one-object file's record before it is rewritten; undefined for a missing or damaged file, which the write
 * may replace. A file in a newer format is refused, so an old binary never overwrites what a newer one wrote.
 */
export function writableObject(file, text, knownVersion) {
    const record = text === undefined ? undefined : parseObject(text.trim());
    const version = record === undefined ? undefined : recordVersion(record);
    if (version !== undefined && version > knownVersion) {
        throw new NewerDataError(file, version, knownVersion);
    }
    return record;
}
