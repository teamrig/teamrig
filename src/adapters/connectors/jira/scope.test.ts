import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jqlString, scopeClause } from './scope.ts';

describe('quoting a value into a Jira search (T5013)', () => {
  it('wraps a value in double quotes, escaping each backslash and double quote', () => {
    assert.equal(jqlString('teamrig'), '"teamrig"');
    assert.equal(jqlString('a"b'), '"a\\"b"');
    assert.equal(jqlString('a\\b'), '"a\\\\b"');
    assert.equal(jqlString('x" OR project = "OPS'), '"x\\" OR project = \\"OPS"');
    assert.equal(jqlString(''), '""');
  });

  it('gives no literal for a value holding a control character', () => {
    for (const value of ['a\nb', 'a\rb', 'a\u0000b', 'a\u007fb', '\t']) {
      assert.equal(jqlString(value), undefined, JSON.stringify(value));
    }
  });
});

describe('the clause a scoped Jira search adds (T5013)', () => {
  it("asks for the signed-in account's and the people's issues, or the scope's labels", () => {
    assert.deepEqual(scopeClause({ all: false, assigned: 'team', labels: ['teamrig', 'ops'] }, ['abc', 'abc', '712020:x']), {
      kind: 'clause',
      jql: 'assignee in (currentUser(), "abc", "712020:x") OR labels in ("teamrig", "ops")',
    });
  });

  it('names currentUser() alone when the team names no people, and no label clause for no labels', () => {
    assert.deepEqual(scopeClause({ all: false, assigned: 'team', labels: [] }, []), { kind: 'clause', jql: 'assignee in (currentUser())' });
  });

  it('asks for labels alone when the scope takes no assignee, and for nothing when it names no label either', () => {
    assert.deepEqual(scopeClause({ all: false, assigned: 'none', labels: ['teamrig', 'teamrig'] }, ['abc']), { kind: 'clause', jql: 'labels in ("teamrig")' });
    assert.deepEqual(scopeClause({ all: false, assigned: 'none', labels: [] }, ['abc']), { kind: 'none' });
  });

  it('fails on a label or an id that no JQL string can carry', () => {
    assert.deepEqual(scopeClause({ all: false, assigned: 'none', labels: ['a\nb'] }, []), {
      kind: 'failed',
      reason: 'the label "a\\nb" cannot be searched in Jira: it holds a control character',
    });
    assert.deepEqual(scopeClause({ all: false, assigned: 'team', labels: [] }, ['a\u0000']), {
      kind: 'failed',
      reason: 'the account id "a\\u0000" cannot be searched in Jira: it holds a control character',
    });
  });
});
