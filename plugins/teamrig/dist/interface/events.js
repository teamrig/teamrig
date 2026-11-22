import { INTERFACE_VERSION } from "./version.js";
/** The events version 1 sends, a frame each. */
export const EVENTS = ['hello', 'changed'];
/** The first frame: every followed document with its revision now. */
export function helloFrame(documents) {
    return { interface: INTERFACE_VERSION, event: 'hello', documents };
}
/**
 * The documents of `now` whose revision is not the one `before` holds, in `now`'s order: what a `changed` frame
 * names. A document `before` does not hold counts as moved.
 */
export function movedDocuments(before, now) {
    const held = new Map(before.map((entry) => [entry.document, entry.revision]));
    return now.filter((entry) => !held.has(entry.document) || held.get(entry.document) !== entry.revision);
}
/** The frame for the documents that moved, or none when nothing did: an empty frame is never sent. */
export function changedFrame(moved) {
    return moved.length === 0 ? undefined : { interface: INTERFACE_VERSION, event: 'changed', documents: moved };
}
