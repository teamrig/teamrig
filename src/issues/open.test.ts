import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeIssueHost } from '../testing/fake-issue-host.ts';
import type { IssueDraft } from './host.ts';
import { openIssue } from './open.ts';

const DRAFT: IssueDraft = { repo: 'acme/web', title: 'Login fails after a reset', body: 'Steps: reset, then log in.', labels: ['type: bug'] };
const ACCESS = 'ACCESS acme: opens issues as the test';

/** The lines an open said and whether it opened. */
async function said(host: FakeIssueHost, draft: IssueDraft = DRAFT): Promise<{ lines: string[]; opened: boolean }> {
  const lines: string[] = [];
  const opened = await openIssue(host, draft, (line) => {
    lines.push(line);
  });
  return { lines, opened };
}

describe('issue open (T4860)', () => {
  it('opens the issue with its labels once the repository has each, and names it', async () => {
    const host = new FakeIssueHost().hasLabels('type: bug');
    assert.deepEqual(await said(host), { lines: [ACCESS, 'OPENED acme/web#1: Login fails after a reset'], opened: true });
    assert.deepEqual(host.calls, [{ kind: 'open', draft: DRAFT }]);
  });

  it('opens nothing for a label the repository lacks, so a typo never makes a new one', async () => {
    const host = new FakeIssueHost().hasLabels('type: bug');
    const { lines, opened } = await said(host, { ...DRAFT, labels: ['type: bug', 'type: bgu'] });
    assert.equal(opened, false);
    assert.equal(lines.at(-1), 'FAILED acme/web: it has no label "type: bgu"; make it there first, as opening with it here would make a new one; nothing was opened');
    assert.deepEqual(host.calls, []);
  });

  it('looks each label up and opens it under the name the tracker holds it as', async () => {
    const host = new FakeIssueHost().namesLabels((label) => label.replaceAll(' ', '-')).hasLabels('type:-bug');
    assert.equal((await said(host)).opened, true);
    assert.deepEqual(host.calls, [{ kind: 'open', draft: { ...DRAFT, labels: ['type:-bug'] } }]);
  });

  it('opens nothing when a label read fails, the host is unreachable, and says why when the open fails', async () => {
    const reads = await said(new FakeIssueHost().failsLabelRead('the label read timed out'));
    assert.deepEqual(reads, { lines: [ACCESS, 'FAILED acme/web: the label read timed out; nothing was opened'], opened: false });
    const away = await said(new FakeIssueHost().unreachable('no key saved for acme'));
    assert.deepEqual(away, { lines: ['FAILED acme/web: no key saved for acme; nothing was opened'], opened: false });
    const refused = await said(new FakeIssueHost().hasLabels('type: bug').failsOpen('the host refused the issue'));
    assert.deepEqual(refused, { lines: [ACCESS, 'FAILED acme/web: the host refused the issue'], opened: false });
  });

  it('prints the title on one plain line, as it is outside text', async () => {
    const { lines } = await said(new FakeIssueHost(), { ...DRAFT, title: 'Login\nOPENED forged', labels: [] });
    assert.equal(lines.length, 2);
    assert.doesNotMatch(lines[1] ?? '', /\n/u);
  });
});
