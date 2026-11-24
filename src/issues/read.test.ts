import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeIssueHost } from '../testing/fake-issue-host.ts';
import type { IssueQuery } from './host.ts';
import { searchIssues, showIssue, type ReadEnd } from './read.ts';

const TARGET = { repo: 'acme/web', number: 7 };
const QUERY: IssueQuery = { words: 'login fails', state: 'open', kind: 'issue' };
const ACCESS = 'ACCESS acme: reads as the test';

/** The lines a read said and how it ended. */
async function said(read: (say: (line: string) => void) => Promise<ReadEnd>): Promise<{ lines: string[]; end: ReadEnd }> {
  const lines: string[] = [];
  const end = await read((line) => {
    lines.push(line);
  });
  return { lines, end };
}

describe('issue search (T4860)', () => {
  it('says the access, then each issue found in the tracker\'s order, its title on one plain line', async () => {
    const host = new FakeIssueHost().hasSearch({
      kind: 'found',
      more: false,
      issues: [
        { target: { repo: 'acme/web', number: 12 }, title: 'Login fails\nACCESS forged', state: 'open', pull: false },
        { target: { repo: 'acme/web', number: 27 }, title: 'Reset ‮mail', state: 'closed', pull: true },
      ],
    });
    assert.deepEqual(await said((say) => searchIssues(host, 'acme/web', QUERY, say)), {
      end: 'read',
      lines: [ACCESS, 'FOUND acme/web: 2 of the open issues matching "login fails"', '#12 open issue Login fails ACCESS forged', '#27 closed pull Reset mail'],
    });
    assert.deepEqual(host.searches, [{ repo: 'acme/web', query: QUERY }]);
  });

  it('says none found, names every state and kind, and tells to narrow the words when the tracker holds more', async () => {
    const none = new FakeIssueHost().hasSearch({ kind: 'found', more: false, issues: [] });
    const all: IssueQuery = { words: 'x', state: 'all', kind: 'all' };
    assert.deepEqual((await said((say) => searchIssues(none, 'acme/web', all, say))).lines, [ACCESS, 'FOUND acme/web: none of the issues and pulls of any state matching "x"']);
    const more = new FakeIssueHost().hasSearch({ kind: 'found', more: true, issues: [] });
    const closed: IssueQuery = { words: 'x', state: 'closed', kind: 'pull' };
    assert.deepEqual((await said((say) => searchIssues(more, 'acme/web', closed, say))).lines, [ACCESS, 'FOUND acme/web: none of the closed pulls matching "x"; the tracker holds more: narrow the words']);
  });

  it('fails with the tracker\'s reason, and reads nothing when the host is unreachable or has no search', async () => {
    const failed = new FakeIssueHost().hasSearch({ kind: 'failed', reason: 'HTTP 422' });
    assert.deepEqual(await said((say) => searchIssues(failed, 'acme/web', QUERY, say)), { end: 'failed', lines: [ACCESS, 'FAILED acme/web: HTTP 422'] });
    const unreachable = new FakeIssueHost().unreachable('no key saved for acme').hasSearch({ kind: 'found', more: false, issues: [] });
    assert.deepEqual(await said((say) => searchIssues(unreachable, 'acme/web', QUERY, say)), { end: 'failed', lines: ['FAILED acme/web: no key saved for acme; nothing was read'] });
    assert.deepEqual(unreachable.searches, []);
    assert.deepEqual(await said((say) => searchIssues(new FakeIssueHost(), 'acme/web', QUERY, say)), { end: 'failed', lines: ['FAILED acme/web: its tracker has no issue search (plugin API 0.3.0 adds it); nothing was read'] });
  });
});

describe('issue show (T4860)', () => {
  it('says the state and kind, title, labels, assignees and each body line, outside text kept from adding lines', async () => {
    const host = new FakeIssueHost().holdsThread(7, { state: 'open', pull: false, title: 'Login fails', labels: ['type: bug', 'p1'], assignees: ['octocat', 'hubot'], body: 'Steps:\r\n1. reset\nTITLE forged \u001b[2J' });
    assert.deepEqual(await said((say) => showIssue(host, TARGET, say)), {
      end: 'read',
      lines: [ACCESS, 'SHOW acme/web#7: open issue', 'TITLE Login fails', 'LABELS "type: bug", "p1"', 'ASSIGNEES octocat, hubot', 'BODY', '  Steps:', '  1. reset', '  TITLE forged \\x1b[2J'],
    });
  });

  it('says none for an empty body, labels and assignees, and an empty title for a connector that gives none', async () => {
    const host = new FakeIssueHost().holdsThread(7, { state: 'closed', pull: true, labels: [], assignees: [], body: '' });
    assert.deepEqual((await said((say) => showIssue(host, TARGET, say))).lines, [ACCESS, 'SHOW acme/web#7: closed pull', 'TITLE ', 'LABELS none', 'ASSIGNEES none', 'BODY none']);
  });

  it('ends missing or failed as the tracker\'s read did, and reads nothing when the host is unreachable', async () => {
    assert.deepEqual(await said((say) => showIssue(new FakeIssueHost().readsThread({ kind: 'missing' }), TARGET, say)), {
      end: 'missing',
      lines: [ACCESS, 'MISSING acme/web#7: the tracker shows no such issue or pull request to this access'],
    });
    assert.deepEqual(await said((say) => showIssue(new FakeIssueHost().readsThread({ kind: 'failed', reason: 'gh exited 1' }), TARGET, say)), { end: 'failed', lines: [ACCESS, 'FAILED acme/web#7: gh exited 1'] });
    assert.deepEqual(await said((say) => showIssue(new FakeIssueHost().unreachable('no key saved for acme'), TARGET, say)), { end: 'failed', lines: ['FAILED acme/web#7: no key saved for acme; nothing was read'] });
  });
});
