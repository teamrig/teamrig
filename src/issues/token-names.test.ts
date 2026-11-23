import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repoTokenName, SHIP_TOKEN, TOKEN_PREFIX, tokenName } from './token-names.ts';

describe('repoTokenName', () => {
  it("names one repository's credential teamrig-gh-<owner>.<name> in lowercase", () => {
    assert.equal(repoTokenName('Acme/Web.Site'), 'teamrig-gh-acme.web.site');
  });

  it('gives no name for what is no owner/name', () => {
    for (const repo of ['acme', 'acme/', '/web', 'acme/web/x']) {
      assert.equal(repoTokenName(repo), undefined, repo);
    }
  });

  it('gives no name past the 128 characters of a credential name, so the owner key reaches that repository', () => {
    const prefix = 'teamrig-gh-acme.';
    const longest = 'w'.repeat(128 - prefix.length);
    assert.equal(repoTokenName(`acme/${longest}`), `${prefix}${longest}`);
    assert.equal(repoTokenName(`acme/${longest}w`), undefined);
  });
});

describe('tokenName', () => {
  it("names an owner's credential teamrig-gh-<owner> in lowercase", () => {
    assert.equal(tokenName('Acme'), 'teamrig-gh-acme');
    assert.equal(tokenName('acme').startsWith(TOKEN_PREFIX), true);
  });

  it("keeps the ship tool's credential apart from every owner's", () => {
    assert.equal(SHIP_TOKEN.startsWith(TOKEN_PREFIX), false);
  });
});
