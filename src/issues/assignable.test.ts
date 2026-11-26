import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeIssueHost } from '../testing/fake-issue-host.ts';
import { assignableOf, readAssignable } from './assignable.ts';

describe('readAssignable', () => {
  it('reads each login once, as the host spells it, and lists those the repository may not assign', async () => {
    const host = new FakeIssueHost().spells('MonaLisa').cannotAssign('outsider');
    const read = await readAssignable(host, 'acme/web', ['monalisa', 'outsider', 'monalisa', 'octocat']);
    assert.deepEqual(read, { kind: 'read', spelled: new Map([['monalisa', 'MonaLisa'], ['octocat', 'octocat']]), unassignable: ['outsider'] });
    assert.deepEqual(assignableOf(['outsider', 'octocat', 'monalisa'], read.kind === 'read' ? read : { spelled: new Map() }), ['octocat', 'MonaLisa']);
  });

  it('stops at a failed read', async () => {
    const host = new FakeIssueHost().readsAssignee({ kind: 'failed', reason: 'gh was stopped' });
    assert.deepEqual(await readAssignable(host, 'acme/web', ['octocat']), { kind: 'failed', reason: 'gh was stopped' });
  });
});
