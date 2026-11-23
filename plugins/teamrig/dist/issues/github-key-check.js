import { isRecord, stringField } from "../core/guards.js";
/** The one address a key is checked at: GitHub's own API host, over https, whatever the key's scope (C7). */
export const GITHUB_KEY_CHECK_URL = 'https://api.github.com/user';
/** A key this close to its expiry is warned about, so it is renewed before a session's push fails on it. */
const EXPIRY_WARN_DAYS = 7;
const DAY_MS = 86_400_000;
export function githubKeyKindOf(secret) {
    if (secret.startsWith('github_pat_')) {
        return 'fine-grained';
    }
    if (secret.startsWith('ghp_')) {
        return 'classic';
    }
    return /^gh[ousr]_/u.test(secret) ? 'app or OAuth' : 'unknown';
}
/** Asks GitHub who `secret` belongs to, sending it only to {@link GITHUB_KEY_CHECK_URL}. */
export async function checkGithubKey(http, secret) {
    const result = await http.send({
        method: 'GET',
        url: GITHUB_KEY_CHECK_URL,
        headers: { authorization: `Bearer ${secret}`, accept: 'application/vnd.github+json', 'user-agent': 'teamrig', 'x-github-api-version': '2022-11-28' },
    });
    if (result.kind === 'failed') {
        return { kind: 'failed', reason: result.reason };
    }
    // Only 401 says the key itself is bad; a 403 is as often a rate limit, so it stays a failed check.
    if (result.status === 401) {
        return { kind: 'rejected', status: result.status };
    }
    const login = result.status === 200 ? loginOf(result.body) : undefined;
    if (login === undefined) {
        return { kind: 'failed', reason: `GitHub answered ${result.status} with no user` };
    }
    const scopesHeader = result.headers['x-oauth-scopes'];
    const expiry = result.headers['github-authentication-token-expiration'];
    return {
        kind: 'valid',
        login,
        keyKind: githubKeyKindOf(secret),
        scopes: scopesHeader === undefined ? undefined : scopesHeader.split(',').map((scope) => scope.trim()).filter((scope) => scope !== ''),
        expires: expiry === undefined ? 'none' : (expiryOf(expiry) ?? 'unreadable'),
    };
}
function loginOf(body) {
    try {
        const parsed = JSON.parse(body);
        return isRecord(parsed) ? stringField(parsed, 'login') : undefined;
    }
    catch {
        return undefined;
    }
}
/** GitHub's expiry header, `2030-02-01 10:00:00 UTC` or with an offset such as `+0200`, as epoch ms. */
export function expiryOf(header) {
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{2}:?\d{2})$/u.exec(header.trim());
    if (match === null) {
        return undefined;
    }
    const [, day, time, zone] = match;
    const offset = zone === 'UTC' || zone === undefined ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
    const ms = Date.parse(`${day ?? ''}T${time ?? ''}${offset}`);
    return Number.isNaN(ms) ? undefined : ms;
}
export function keyCheckText(check, now) {
    const rights = check.scopes === undefined ? 'rights set per repository' : `scopes ${check.scopes.length === 0 ? 'none' : check.scopes.join(', ')}`;
    const warnings = [];
    if (check.keyKind !== 'fine-grained') {
        warnings.push(`a ${check.keyKind} key reaches every repository its user can; a fine-grained key limited to the team's repositories is safer`);
    }
    return { summary: `${check.login}, ${check.keyKind}, ${rights}, ${expiryText(check.expires, now, warnings)}`, warnings };
}
function expiryText(expires, now, warnings) {
    if (expires === 'none') {
        warnings.push('the key never expires; one with an expiry limits what a leaked key can do');
        return 'no expiry';
    }
    if (expires === 'unreadable') {
        return 'expiry unreadable';
    }
    const day = new Date(expires).toISOString().slice(0, 10);
    const days = Math.floor((expires - now) / DAY_MS);
    if (expires <= now) {
        warnings.push(`the key expired on ${day}; save a new one`);
        return `expired ${day}`;
    }
    if (days < EXPIRY_WARN_DAYS) {
        warnings.push(`the key expires in ${days} day(s), on ${day}; renew it`);
    }
    return `expires ${day}`;
}
