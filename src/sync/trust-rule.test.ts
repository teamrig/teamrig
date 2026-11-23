import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importsProject, judgeTrust, matches, resolveTrust, type ResolvedTrust, type SiteTrust, type TrustAuthor, type TrustDefaults, type TrustFacts } from './trust-rule.ts';

const SITE_ACCOUNTS = { kind: 'accountType', types: ['atlassian'] } as const;
const DEFAULTS: TrustDefaults = { inside: [SITE_ACCOUNTS], edits: 'inside' };
const KEY = 'connectors.jira.trust.projects.ENG.inside';
const MAIL = { kind: 'accounts', ids: ['mail-1'] } as const;

const colleague: TrustAuthor = { accountId: 'acc-1', accountType: 'atlassian' };
const customer: TrustAuthor = { accountId: 'cus-1', accountType: 'customer' };

function site(overrides: Partial<SiteTrust> = {}): SiteTrust {
  return { inside: undefined, never: [], edits: undefined, projects: new Map(), ...overrides };
}

function rule(overrides: Partial<ResolvedTrust> = {}): ResolvedTrust {
  return { inside: [SITE_ACCOUNTS], never: [], edits: 'inside', heldDefault: undefined, ...overrides };
}

function facts(author: TrustAuthor | undefined, editors: readonly TrustAuthor[] = []): TrustFacts {
  return { author, editors: { kind: 'read', editors } };
}

describe('resolveTrust', () => {
  it('takes the default inside and edits on a closed project when nothing is written', () => {
    assert.deepEqual(resolveTrust(site(), 'ENG', DEFAULTS, false, KEY), { inside: [SITE_ACCOUNTS], never: [], edits: 'inside', heldDefault: undefined });
  });

  it('holds the default inside back on a public project and names the key to set', () => {
    const resolved = resolveTrust(site(), 'ENG', DEFAULTS, true, KEY);
    assert.deepEqual(resolved.inside, []);
    assert.equal(resolved.heldDefault, KEY);
  });

  it('keeps a written inside on a public project', () => {
    const written = [{ kind: 'accounts', ids: ['acc-1'] }] as const;
    assert.deepEqual(resolveTrust(site({ inside: written }), 'ENG', DEFAULTS, true, KEY).inside, written);
  });

  it('lets a project replace inside and edits but adds its never to the site never', () => {
    const own = { inside: [MAIL], never: [{ kind: 'accounts', ids: ['bot-9'] }], edits: 'any', import: true } as const;
    const resolved = resolveTrust(site({ never: [MAIL], edits: 'inside', projects: new Map([['ENG', own]]) }), 'ENG', DEFAULTS, false, KEY);
    assert.deepEqual(resolved.inside, [MAIL]);
    assert.equal(resolved.edits, 'any');
    assert.deepEqual(resolved.never, [MAIL, { kind: 'accounts', ids: ['bot-9'] }]);
  });

  it('leaves another project on the site rule', () => {
    const own = { inside: [MAIL], never: [], edits: undefined, import: true } as const;
    assert.deepEqual(resolveTrust(site({ projects: new Map([['OPS', own]]) }), 'ENG', DEFAULTS, false, KEY).inside, [SITE_ACCOUNTS]);
  });
});

describe('importsProject', () => {
  it('reads a project unless its rule says import false', () => {
    const off = { inside: undefined, never: [], edits: undefined, import: false } as const;
    const trust = site({ projects: new Map([['OPS', off]]) });
    assert.equal(importsProject(trust, 'OPS'), false);
    assert.equal(importsProject(trust, 'ENG'), true);
  });
});

describe('matches', () => {
  it('never matches an account type the tracker did not give', () => {
    assert.equal(matches(SITE_ACCOUNTS, { accountId: 'acc-1', accountType: undefined }), false);
  });

  it('never matches an empty account id by accounts', () => {
    assert.equal(matches({ kind: 'accounts', ids: [''] }, { accountId: '', accountType: 'atlassian' }), false);
  });
});

describe('judgeTrust', () => {
  it('trusts a site account under the default and says which block let it in', () => {
    assert.deepEqual(judgeTrust(rule(), facts(colleague)), { trusted: true, why: 'the reporter matches inside (accountType atlassian)' });
  });

  it('leaves out a customer account', () => {
    const verdict = judgeTrust(rule(), facts(customer));
    assert.equal(verdict.trusted, false);
    assert.match(verdict.why, /customer account\) matches no inside/);
  });

  it('leaves out an anonymous or hidden reporter', () => {
    assert.equal(judgeTrust(rule(), facts(undefined)).trusted, false);
    assert.equal(judgeTrust(rule(), facts({ accountId: '', accountType: 'atlassian' })).trusted, false);
  });

  it('lets never win over inside', () => {
    const verdict = judgeTrust(rule({ never: [{ kind: 'accounts', ids: ['acc-1'] }] }), facts(colleague));
    assert.deepEqual(verdict, { trusted: false, why: 'the reporter matches never (accounts acc-1)', failed: undefined });
  });

  it('names the key to set when the guard held the default back', () => {
    const verdict = judgeTrust(rule({ inside: [], heldDefault: KEY }), facts(colleague));
    assert.equal(verdict.trusted, false);
    assert.match(verdict.why, /connectors\.jira\.trust\.projects\.ENG\.inside$/);
  });

  it('drops the trust of an issue an outsider edited, under edits inside', () => {
    const verdict = judgeTrust(rule(), facts(colleague, [colleague, customer]));
    assert.equal(verdict.trusted, false);
    assert.match(verdict.why, /edited by cus-1, who is not inside/);
  });

  it('drops the trust of an issue edited by an inside account that never names', () => {
    const verdict = judgeTrust(rule({ never: [{ kind: 'accounts', ids: ['acc-2'] }] }), facts(colleague, [{ accountId: 'acc-2', accountType: 'atlassian' }]));
    assert.equal(verdict.trusted, false);
  });

  it('keeps the trust through an outsider edit under edits any', () => {
    assert.equal(judgeTrust(rule({ edits: 'any' }), facts(colleague, [customer])).trusted, true);
  });

  it('takes no decision on an edit history it could not read whole, and says why for the FAILED line', () => {
    const verdict = judgeTrust(rule(), { author: colleague, editors: { kind: 'unread', why: 'changelog page 2 answered 500' } });
    assert.deepEqual(verdict, { trusted: false, why: 'its edit history could not be read whole', failed: 'changelog page 2 answered 500' });
  });

  it('needs no edit history under edits any', () => {
    assert.equal(judgeTrust(rule({ edits: 'any' }), { author: colleague, editors: { kind: 'unread', why: 'not read' } }).trusted, true);
  });
});
