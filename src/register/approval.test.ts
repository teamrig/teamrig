import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LeadTree } from '../config/lead-tree.ts';
import { testConfig } from '../testing/config.ts';
import { testTask } from '../testing/task.ts';
import { answerNamesFullHead, answerNamesHead, answerTo, approvalCleared, approvedTaskOf, isCommitSha, isFullCommitSha, waitAnswerersOf } from './approval.ts';
import type { ApprovalAnswer } from './fold.ts';
import type { WaitReason } from './waits.ts';

const LEAD: WaitReason = { kind: 'approval', who: 'lead' };
const APPROVED: ApprovalAnswer = { verdict: 'approved', by: 'lead', at: '2030-01-07T11:00:00.000Z', note: 'tests green' };
const DECLINED: ApprovalAnswer = { ...APPROVED, verdict: 'declined', note: 'add the test' };

describe('answerTo (T996)', () => {
  it("gives the giver's answer to an approval wait either way, and nothing for another wait or giver", () => {
    assert.equal(answerTo(testTask({ answer: APPROVED }), LEAD), APPROVED);
    assert.equal(answerTo(testTask({ answer: DECLINED }), LEAD), DECLINED);
    assert.equal(answerTo(testTask({ answer: APPROVED }), { kind: 'approval', who: 'owner' }), undefined, "the lead's answer is not the owner's");
    assert.equal(answerTo(testTask({ answer: APPROVED }), { kind: 'decision', who: 'lead' }), undefined, 'a decision is not an approval');
    assert.equal(answerTo(testTask(), LEAD), undefined, 'unanswered');
  });
});

describe('isCommitSha (T4817)', () => {
  it('takes a full or abbreviated lowercase sha of 7 to 40 hex digits, and nothing else', () => {
    assert.equal(isCommitSha('abc1234'), true);
    assert.equal(isCommitSha('a'.repeat(40)), true);
    assert.equal(isCommitSha('abc123'), false, 'too short');
    assert.equal(isCommitSha('a'.repeat(41)), false, 'too long');
    assert.equal(isCommitSha('ABC1234'), false, 'uppercase');
    assert.equal(isCommitSha('abc1234 '), false, 'trailing text');
  });
});

describe('answerNamesHead (T2788, T4817)', () => {
  const HEAD = 'abc1234def5678';

  it('holds when the note names a sha the head starts with, anywhere in it', () => {
    assert.equal(answerNamesHead(testTask({ answer: { ...APPROVED, note: 'OK abc1234: check PASS' } }), HEAD), true);
    assert.equal(answerNamesHead(testTask({ answer: { ...APPROVED, note: `head ${HEAD}` } }), HEAD), true);
  });

  it("fails for another head's sha, a sha the head only contains, no sha, or no answer", () => {
    assert.equal(answerNamesHead(testTask({ answer: { ...APPROVED, note: 'OK 9999999' } }), HEAD), false, 'an earlier head');
    assert.equal(answerNamesHead(testTask({ answer: { ...APPROVED, note: 'OK 1234def' } }), HEAD), false, 'not a prefix');
    assert.equal(answerNamesHead(testTask({ answer: APPROVED }), HEAD), false, 'names no sha');
    assert.equal(answerNamesHead(testTask(), HEAD), false, 'unanswered');
  });
});

describe('waitAnswerersOf (T828)', () => {
  const tree = new LeadTree(testConfig({ leads: { alpha: ['bravo'] } }));

  it("adds the security reviewer to an approval's answerers, never to a decision's", () => {
    assert.deepEqual(waitAnswerersOf(tree, { securityReviewer: 'security' }, 'bravo'), { decision: ['alpha', 'lead'], approval: ['alpha', 'lead', 'security'] });
  });

  it("leaves the leaders alone with no reviewer, on the reviewer's own task, or when the reviewer is a leader already", () => {
    assert.deepEqual(waitAnswerersOf(tree, {}, 'bravo'), { decision: ['alpha', 'lead'], approval: ['alpha', 'lead'] });
    assert.deepEqual(waitAnswerersOf(tree, { securityReviewer: 'security' }, 'security'), { decision: ['lead'], approval: ['lead'] });
    assert.deepEqual(waitAnswerersOf(tree, { securityReviewer: 'alpha' }, 'bravo'), { decision: ['alpha', 'lead'], approval: ['alpha', 'lead'] });
  });
});

describe('approvalCleared (T684)', () => {
  it('clears an approval wait its giver approved, and nothing else', () => {
    const answered = testTask({ answer: APPROVED });
    assert.equal(approvalCleared(answered, LEAD), true);
    assert.equal(approvalCleared(testTask({ answer: DECLINED }), LEAD), false);
    assert.equal(approvalCleared(answered, { kind: 'approval', who: 'owner' }), false, "the lead's answer is not the owner's");
    assert.equal(approvalCleared(answered, { kind: 'decision', who: 'lead' }), false, 'a decision is not an approval');
    assert.equal(approvalCleared(testTask(), LEAD), false, 'unanswered');
  });
});

describe('approvedTaskOf (T684, T781)', () => {
  const waiting = { status: 'waiting', owner: 'alpha', waits: [LEAD] } as const;

  it("finds the owner's waiting task that the lead approved, and says who did", () => {
    const tasks = [testTask({ id: 'T1', ...waiting }), testTask({ id: 'T2', ...waiting, answer: APPROVED })];
    const approved = approvedTaskOf(tasks, 'alpha', ['lead']);
    assert.deepEqual([approved?.task.id, approved?.by], ['T2', 'lead']);
  });

  it("finds one a sub-lead above the owner approved, but none from a leader outside the owner's chain", () => {
    const sub: WaitReason = { kind: 'approval', who: 'bravo' };
    const tasks = [testTask({ id: 'T1', ...waiting, waits: [sub], answer: { ...APPROVED, by: 'bravo' } })];
    const approved = approvedTaskOf(tasks, 'alpha', ['bravo', 'lead']);
    assert.deepEqual([approved?.task.id, approved?.by], ['T1', 'bravo']);
    assert.equal(approvedTaskOf(tasks, 'alpha', ['lead']), undefined, 'bravo leads someone else, not alpha');
  });

  it("finds none in another owner's task, a decline, the owner's approval, or a task no longer waiting", () => {
    const tasks = [
      testTask({ id: 'T1', ...waiting, owner: 'bravo', answer: APPROVED }),
      testTask({ id: 'T2', ...waiting, answer: { ...APPROVED, verdict: 'declined' } }),
      testTask({ id: 'T3', ...waiting, waits: [{ kind: 'approval', who: 'owner' }], answer: { ...APPROVED, by: 'owner' } }),
      testTask({ id: 'T4', ...waiting, status: 'verifying', answer: APPROVED }),
    ];
    assert.equal(approvedTaskOf(tasks, 'alpha', ['lead']), undefined);
  });
});

describe('isFullCommitSha and answerNamesFullHead (T4958 C1)', () => {
  const head = 'ab'.repeat(20);
  it('takes only a full 40-hex sha', () => {
    assert.equal(isFullCommitSha(head), true);
    assert.equal(isFullCommitSha(head.slice(0, 12)), false, 'a prefix');
    assert.equal(isFullCommitSha(`${head}a`), false, 'too long');
    assert.equal(isFullCommitSha(head.toUpperCase()), false, 'uppercase');
  });
  it('holds an approval to the head it names in full, never a prefix of it', () => {
    assert.equal(answerNamesFullHead(testTask({ answer: { ...APPROVED, note: `ok at ${head}` } }), head), true);
    assert.equal(answerNamesFullHead(testTask({ answer: { ...APPROVED, note: `ok at ${head.slice(0, 7)}` } }), head), false);
    assert.equal(answerNamesFullHead(testTask({ answer: { ...APPROVED, note: `ok at ${'c'.repeat(40)}` } }), head), false);
    assert.equal(answerNamesFullHead(testTask({ answer: null }), head), false);
  });
});
