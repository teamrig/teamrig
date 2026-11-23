import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TRUST_ACCOUNTS, NO_TRUST_RULE, parseTrustRule, type TrustSyntax } from './trust-config.ts';
import type { SiteTrust } from './trust-rule.ts';

const SYNTAX: TrustSyntax = {
  accountTypes: ['atlassian', 'customer', 'app'],
  accountId: /^[A-Za-z0-9:_-]{1,128}$/,
  projectKey: (text) => (/^[A-Z][A-Z0-9_]*$/.test(text) ? text : undefined),
};

function read(value: unknown): { readonly rule: SiteTrust; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const rule = parseTrustRule(value, 'trust', SYNTAX, (key, problem) => problems.push(`${key}: ${problem}`));
  return { rule, problems };
}

describe('parseTrustRule', () => {
  it('reads no key as the connector defaults', () => {
    assert.deepEqual(read(undefined), { rule: NO_TRUST_RULE, problems: [] });
  });

  it('reads a whole rule with a project override', () => {
    const { rule, problems } = read({
      inside: [{ accountType: ['atlassian'] }, { accounts: ['5b10ac8d82e05b22cc7d4ef5'] }],
      never: [{ accounts: ['mail-1'] }],
      edits: 'any',
      projects: { SUP: { inside: [{ accounts: ['agent-1'] }], never: [{ accounts: ['bot-1'] }], edits: 'inside' }, OPS: { import: false } },
    });
    assert.deepEqual(problems, []);
    assert.deepEqual(rule.inside, [
      { kind: 'accountType', types: ['atlassian'] },
      { kind: 'accounts', ids: ['5b10ac8d82e05b22cc7d4ef5'] },
    ]);
    assert.deepEqual(rule.never, [{ kind: 'accounts', ids: ['mail-1'] }]);
    assert.equal(rule.edits, 'any');
    assert.deepEqual(rule.projects.get('SUP'), { inside: [{ kind: 'accounts', ids: ['agent-1'] }], never: [{ kind: 'accounts', ids: ['bot-1'] }], edits: 'inside', import: true });
    assert.deepEqual(rule.projects.get('OPS'), { inside: undefined, never: [], edits: undefined, import: false });
  });

  it('refuses accept until the rule reads it, and any key it does not know', () => {
    const { problems } = read({ accept: { label: 'teamrig' }, insde: [] , projects: { ENG: { accept: null } } });
    assert.deepEqual(problems, [
      'trust.accept: is not read yet: an outsider issue imports only by inside, so drop the key',
      'trust.insde: is no key of a trust rule (inside, never, edits, projects, import)',
      'trust.projects.ENG.accept: is not read yet: an outsider issue imports only by inside, so drop the key',
    ]);
  });

  it('refuses a matcher kind the connector does not read yet, never a silent no-op', () => {
    const { rule, problems } = read({ inside: [{ groups: ['staff'] }] });
    assert.deepEqual(problems, ['trust.inside[0]: groups is not read by this connector yet; name accountType or accounts']);
    assert.deepEqual(rule.inside, []);
  });

  it('reads an inside with a wrong entry as nobody inside, never as the wider default', () => {
    const { rule, problems } = read({ inside: [{ accounts: ['acc-1'] }, { accountType: ['admin'] }] });
    assert.deepEqual(problems, ['trust.inside[1].accountType[0]: must be one of atlassian, customer, app, not "admin"']);
    assert.deepEqual(rule.inside, []);
  });

  it('keeps the good never entries beside a wrong one', () => {
    const { rule, problems } = read({ never: [{ accounts: ['mail-1'] }, { accounts: ['bad id'] }] });
    assert.deepEqual(problems, ['trust.never[1].accounts[0]: must be an account id, not "bad id"']);
    assert.deepEqual(rule.never, [{ kind: 'accounts', ids: ['mail-1'] }]);
  });

  it('refuses a matcher with two kinds, an empty list and a list past the cap', () => {
    const many = Array.from({ length: MAX_TRUST_ACCOUNTS + 1 }, (_, index) => `acc-${index}`);
    const { problems } = read({ never: [{ accounts: ['a'], accountType: ['app'] }, { accounts: [] }, { accounts: many }] });
    assert.equal(problems.length, 3);
    assert.match(problems[0] ?? '', /^trust\.never\[0\]: must be one matcher/);
    assert.equal(problems[1], 'trust.never[1].accounts: must be a list of one or more names');
    assert.equal(problems[2], `trust.never[2].accounts: names more than the ${MAX_TRUST_ACCOUNTS} the rule takes`);
  });

  it('reads a wrong edits as inside, the narrower one', () => {
    const { rule, problems } = read({ edits: 'anyone' });
    assert.deepEqual(problems, ['trust.edits: must be "inside" or "any", not "anyone"']);
    assert.equal(rule.edits, 'inside');
  });

  it('refuses a project name that is no key and a rule that is no object', () => {
    assert.deepEqual(read({ projects: { 'eng-1': {} } }).problems, ['trust.projects.eng-1: must be a project key, not "eng-1"']);
    const notObject = read('atlassian');
    assert.equal(notObject.problems.length, 1);
    assert.deepEqual(notObject.rule.inside, []);
  });

  it('reads a project import that is no boolean as no import, the narrower one, and says so', () => {
    const { rule, problems } = read({ projects: { OPS: { import: 'no' } } });
    assert.deepEqual(problems, ['trust.projects.OPS.import: must be true or false, not "no"']);
    assert.equal(rule.projects.get('OPS')?.import, false);
  });
});
