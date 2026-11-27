import { knownFrom } from "./known.js";
/**
 * How freely a host lets a session act, under teamrig's own names, so guards and the pane read one list across
 * hosts. `unmapped` is a word the host's adapter does not map: kept as it is, never guessed into a nearer mode.
 */
export const PERMISSION_MODES = ['ask', 'accept-edits', 'plan', 'no-prompts', 'auto', 'bypass', 'unmapped'];
/**
 * The mode `hostWord` maps to in an adapter's `table`, matched exactly and case-sensitively: a prefix, a substring or
 * another case of a word is `unmapped`, so a host's new word is never read as one it resembles.
 */
export function observedPermission(hostWord, table) {
    return { mode: Object.hasOwn(table, hostWord) ? (table[hostWord] ?? 'unmapped') : 'unmapped', hostWord };
}
/**
 * The effective config one hook call reports: each field as the hook input told it, unknown where it told none. A hook
 * input is the host's report of the moment it fires at, so a field it carries is what took effect.
 */
export function effectiveOf(event) {
    return {
        model: knownFrom(event.model, 'hook-input'),
        effort: knownFrom(event.effort, 'hook-input'),
        permissionMode: knownFrom(event.permission, 'hook-input'),
    };
}
