import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testHostIssue } from '../testing/host-issue.ts';
import type { HostIssue } from '../issues/issue.ts';
import { formatReportersFile, insideReporters, parseReportersFile, reporterLines, REPORTERS_FILE_FORMAT } from './reporters.ts';

const LET_IN = { trusted: true, why: 'the reporter matches inside (accountType atlassian)' } as const;
const KEPT_OUT = { trusted: false, why: 'the reporter matches never (accounts)', failed: undefined } as const;

/** Open issue `number` reported by `author` (named `authorName`), let in by the tracker's rule unless `over` says else. */
function reported(number: number, author: string, authorName: string, over: Partial<HostIssue> = {}): HostIssue {
  return testHostIssue(number, { author, authorName, ruled: LET_IN, ...over });
}

describe('insideReporters (T5012)', () => {
  it('counts the open let-in issues per reporter, most first, then by id', () => {
    const issues = [
      reported(1, 'b-two', 'Bea'),
      reported(2, 'a-one', 'Ari'),
      reported(3, 'c-many', 'Mailbox'),
      reported(4, 'c-many', 'Mailbox'),
      reported(5, 'c-many', 'Mailbox'),
    ];
    assert.deepEqual(insideReporters(issues), [
      { id: 'c-many', name: 'Mailbox', count: 3 },
      { id: 'a-one', name: 'Ari', count: 1 },
      { id: 'b-two', name: 'Bea', count: 1 },
    ]);
  });

  it('counts none of a kept-out, closed, tie-judged or reporter-less issue', () => {
    const issues = [
      reported(1, 'out', 'Out', { ruled: KEPT_OUT }),
      reported(2, 'closed', 'Closed', { state: 'closed' }),
      reported(3, 'tied', 'Tied', { ruled: undefined }),
      reported(4, '', 'Hidden'),
    ];
    assert.deepEqual(insideReporters(issues), []);
  });
});

describe('reporterLines (T5012)', () => {
  it('names each reporter with its count, marking those no --yes saw, and makes a name one plain line', () => {
    const reporters = [
      { id: 'c-many', name: 'Mail\u001b[31mbox\nline', count: 3 },
      { id: 'a-one', name: '', count: 1 },
    ];
    assert.deepEqual(reporterLines('acme/eng', reporters, new Set(['a-one'])), [
      'REPORTER acme/eng: c-many (Mail [31mbox line) let in 3 issue(s), NEW since the last --yes',
      'REPORTER acme/eng: a-one (no name given) let in 1 issue(s)',
    ]);
  });
});

describe('the reporters file (T5012)', () => {
  it('reads back the ids it wrote, sorted', () => {
    const text = formatReportersFile(new Set(['b', 'a']));
    assert.deepEqual(JSON.parse(text), { format: REPORTERS_FILE_FORMAT, seen: ['a', 'b'] });
    assert.deepEqual(parseReportersFile(text), new Set(['a', 'b']));
  });

  it('reads a missing, broken or other-format file, and non-string ids, as none seen', () => {
    assert.deepEqual(parseReportersFile(''), new Set());
    assert.deepEqual(parseReportersFile('{not json'), new Set());
    assert.deepEqual(parseReportersFile(JSON.stringify({ format: 99, seen: ['a'] })), new Set());
    assert.deepEqual(parseReportersFile(JSON.stringify({ format: REPORTERS_FILE_FORMAT, seen: ['a', 7, null] })), new Set(['a']));
  });
});
