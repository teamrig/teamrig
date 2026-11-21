import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jiraRefs } from './refs.ts';

describe('the refs of Jira issues (T4912)', () => {
  const refs = jiraRefs('acme');

  it('writes an issue of the named site as its key, in capitals, after jira:', () => {
    assert.equal(refs.refOf({ repo: 'acme/eng', number: 12 }), 'jira:ENG-12');
    assert.equal(refs.refOf({ repo: 'acme/ops_2', number: 7 }), 'jira:OPS_2-7');
  });

  it('reads a ref back as the same issue of the named site', () => {
    assert.deepEqual(refs.parseRef('jira:ENG-12'), { repo: 'acme/eng', number: 12 });
    assert.deepEqual(refs.parseRef('jira:OPS_2-7'), { repo: 'acme/ops_2', number: 7 });
  });

  it('writes no ref for an issue of another site, nor for a place that is no Jira project', () => {
    assert.equal(refs.refOf({ repo: 'other/eng', number: 12 }), undefined);
    assert.equal(refs.refOf({ repo: 'acme/eng/x', number: 12 }), undefined);
    assert.equal(refs.refOf({ repo: 'acme.evil/eng', number: 12 }), undefined);
  });

  it("reads no issue from another connector's ref, a free-text ref, or a key that is no issue key", () => {
    for (const ref of ['gh:acme/eng#12', 'https://acme.atlassian.net/browse/ENG-12', 'local: kept here', 'T12', 'jira:', 'jira:ENG', 'jira:ENG-0', 'jira:ENG-01', 'jira:eng-12', 'jira:ENG-12x', 'jira: ENG-12', 'jira:1ENG-12', 'jira:ENG-12345678901']) {
      assert.equal(refs.parseRef(ref), undefined, ref);
    }
  });

  it('reads and writes no ref while the config names no site', () => {
    const siteless = jiraRefs(undefined);
    assert.equal(siteless.refOf({ repo: 'acme/eng', number: 12 }), undefined);
    assert.equal(siteless.parseRef('jira:ENG-12'), undefined);
  });
});
