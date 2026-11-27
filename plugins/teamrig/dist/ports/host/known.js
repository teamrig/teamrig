/**
 * A fact about a session as a host reported it, kept apart from what teamrig asked for: `known` only when the host
 * told it, with where it was read, else why it is unknown. A plain `undefined` mixes "the host told nothing this time"
 * with "this host never tells it", and a reader acting on the fact needs to tell those apart.
 */
/** Where a host reported a fact. */
export const OBSERVED_FROM = ['hook-input', 'status-line', 'environment', 'transcript'];
/** Why a fact is unknown: the host did not tell it this time, or the host has no way to tell it at all. */
export const UNKNOWN_WHY = ['not-told', 'host-cannot-tell'];
/** The fact `value` read from `source`, or unknown for `why` when the host told none. */
export function knownFrom(value, source, why = 'not-told') {
    return value === undefined ? { known: false, why } : { known: true, value, source };
}
/** A fact this host has no way to report. */
export function hostCannotTell() {
    return { known: false, why: 'host-cannot-tell' };
}
