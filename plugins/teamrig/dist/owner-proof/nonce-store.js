import { isRecord, numberField, stringField } from "../core/guards.js";
import { isHex64 } from "./challenge.js";
import { issueNonce, newNonce, nonceState, pruneNonces, useNonce } from "./nonces.js";
/** The version of the ledger file's shape; a file of another version is refused, never guessed at. */
export const NONCE_LEDGER_VERSION = 1;
/** A ledger file teamrig cannot read: every proof is refused while it stays so, since a lost "used" mark is a replay. */
export class NonceLedgerError extends Error {
    constructor(path, why) {
        super(`the owner-proof nonce ledger ${path} cannot be read (${why}); no owner proof is taken until it is fixed`);
        this.name = 'NonceLedgerError';
    }
}
function entryOf(value) {
    if (!isRecord(value))
        return undefined;
    const nonce = stringField(value, 'nonce');
    const actDigest = stringField(value, 'actDigest');
    const expires = numberField(value, 'expires');
    const used = value['used'];
    if (nonce === undefined || !isHex64(nonce) || actDigest === undefined || !isHex64(actDigest))
        return undefined;
    if (expires === undefined || typeof used !== 'boolean')
        return undefined;
    return { nonce, actDigest, expires, used };
}
/** The ledger's entries from its file's text; missing text is an empty ledger, anything unreadable throws. */
export function parseLedger(text, path) {
    if (text === undefined)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new NonceLedgerError(path, 'not JSON');
    }
    if (!isRecord(parsed) || parsed['v'] !== NONCE_LEDGER_VERSION)
        throw new NonceLedgerError(path, 'unknown version');
    const nonces = parsed['nonces'];
    if (!Array.isArray(nonces))
        throw new NonceLedgerError(path, 'no nonce list');
    return nonces.map((value, index) => {
        const entry = entryOf(value);
        if (entry === undefined)
            throw new NonceLedgerError(path, `entry ${index} is damaged`);
        return entry;
    });
}
/** The ledger file's text. */
export function ledgerText(entries) {
    const nonces = entries.map((each) => ({ nonce: each.nonce, actDigest: each.actDigest, expires: each.expires, used: each.used }));
    return `${JSON.stringify({ v: NONCE_LEDGER_VERSION, nonces })}\n`;
}
/**
 * The team's ledger of owner-proof nonces, kept in one file. Each call reads, changes and writes it whole under the
 * mutex, and drops entries past their expiry and grace on the way.
 */
export class NonceLedger {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** A fresh nonce, written to the ledger for the act whose digest is given, until `expires` (ms since the epoch). */
    issue(actDigest, expires) {
        return this.change((entries) => {
            const nonce = newNonce(this.deps.random);
            return { entries: issueNonce(entries, { nonce, actDigest, expires }), result: nonce };
        });
    }
    /**
     * What the ledger knew of the nonce, for `verifyProof`, with the nonce marked used and written back before this
     * returns: a proof is checked against the state it had, and no second call can spend it, whatever the check says.
     */
    take(nonce) {
        return this.change((entries) => {
            const state = nonceState(entries, nonce);
            return { entries: useNonce(entries, nonce).entries, result: state };
        });
    }
    change(step) {
        const { files, mutex, clock, path, graceMs } = this.deps;
        return mutex.run(async () => {
            const read = parseLedger(await files.read(path), path);
            const { entries, result } = step(pruneNonces(read, clock.now(), graceMs));
            await files.write(path, ledgerText(entries));
            return result;
        });
    }
}
