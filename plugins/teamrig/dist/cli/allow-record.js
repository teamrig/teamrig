import { formatConfig } from "../config/load.js";
import { errorMessage, isRecord } from "../core/guards.js";
import { RefusedError } from "./runtime.js";
/** The record, empty when there is none yet. */
export async function readAllowRecord(files, path) {
    const text = await files.read(path);
    if (text === undefined) {
        return new Map();
    }
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        throw new RefusedError(`${path} is not valid JSON (${errorMessage(error)}); nothing written`);
    }
    if (!isRecord(raw)) {
        throw new RefusedError(`${path} is not a JSON object; nothing written`);
    }
    const record = new Map();
    for (const [settingsPath, rules] of Object.entries(raw)) {
        if (!isStringList(rules)) {
            throw new RefusedError(`${path}: ${settingsPath} is not a list of strings; nothing written`);
        }
        record.set(settingsPath, rules);
    }
    return record;
}
/** The record with one settings file's rules replaced; a file left with none drops out. */
export function withOwned(record, settingsPath, rules) {
    const next = new Map(record);
    if (rules.length === 0) {
        next.delete(settingsPath);
    }
    else {
        next.set(settingsPath, [...new Set(rules)]);
    }
    return next;
}
/** True when both records name the same rules, in the same order, for the same files. */
export function sameRecord(left, right) {
    return left.size === right.size && [...left].every(([path, rules]) => {
        const other = right.get(path);
        return other !== undefined && other.length === rules.length && other.every((rule, index) => rule === rules[index]);
    });
}
/** Replaces the record atomically. */
export async function writeAllowRecord(files, path, record) {
    await files.write(path, formatConfig(Object.fromEntries(record)));
}
function isStringList(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
