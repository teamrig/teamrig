/**
 * Reads the candidates in order and gives the first key saved. A read that fails stops the pick there: a wider key
 * never stands in for a narrower one the store holds but could not read, which may be the one with fewer rights.
 */
export async function pickKey(store, candidates) {
    const read = await store.readFirst(candidates.map((candidate) => candidate.credential));
    const candidate = read.kind === 'missing' ? undefined : candidates[read.index];
    if (read.kind === 'missing' || candidate === undefined) {
        return { kind: 'missing', tried: candidates };
    }
    return read.kind === 'found'
        ? { kind: 'found', secret: read.secret, scope: candidate.scope, credential: candidate.credential }
        : { kind: 'failed', scope: candidate.scope, credential: candidate.credential, reason: read.reason };
}
