import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HookReply } from '../ports/host/index.ts';
import { combinedGuardReply, failedGuardReason, type GuardAnswer } from './guard-set.ts';

function replied(guard: string, reply: HookReply | undefined): GuardAnswer {
  return { guard, kind: 'replied', reply };
}

describe('combinedGuardReply (T5553)', () => {
  it('says nothing when every guard lets the call go with nothing to say', () => {
    assert.equal(combinedGuardReply([replied('push-guard', undefined), replied('secret-guard', undefined)]), undefined);
    assert.equal(combinedGuardReply([]), undefined);
    assert.equal(combinedGuardReply([replied('push-guard', {})]), undefined);
  });

  it("passes one guard's reply on as it is", () => {
    const reply: HookReply = { verdict: { kind: 'deny', reason: 'no force-push to main' }, notice: 'refused a push' };
    assert.deepEqual(combinedGuardReply([replied('push-guard', reply), replied('secret-guard', undefined)]), {
      verdict: { kind: 'deny', reason: 'no force-push to main' },
      context: undefined,
      notice: 'refused a push',
      tabTitle: undefined,
      sessionTitle: undefined,
      toolOutput: undefined,
    });
  });

  it("refuses when any guard refuses, with every refusal's reason in the set's order, over another's allow", () => {
    const reply = combinedGuardReply([
      replied('push-guard', { verdict: { kind: 'deny', reason: 'first reason' } }),
      replied('package-guard', { verdict: { kind: 'allow', reason: 'fine by me' } }),
      replied('exec-guard', { verdict: { kind: 'block', reason: 'second reason' } }),
    ]);
    assert.deepEqual(reply?.verdict, { kind: 'deny', reason: 'first reason\nsecond reason' });
  });

  it('allows when a guard allows and none refuses, keeping each reason', () => {
    const reply = combinedGuardReply([
      replied('push-guard', { verdict: { kind: 'allow', reason: 'cleared by the lead' } }),
      replied('package-guard', undefined),
      replied('secret-guard', { verdict: { kind: 'allow' } }),
    ]);
    assert.deepEqual(reply?.verdict, { kind: 'allow', reason: 'cleared by the lead' });
  });

  it("keeps every guard's text for the model and the human, in the set's order", () => {
    const reply = combinedGuardReply([
      replied('push-guard', { context: 'push note', notice: 'push said' }),
      replied('package-guard', { context: 'package note' }),
      replied('secret-guard', { notice: 'secret said' }),
    ]);
    assert.equal(reply?.verdict, undefined);
    assert.equal(reply?.context, 'push note\n\npackage note');
    assert.equal(reply?.notice, 'push said\nsecret said');
  });

  it("refuses a call one guard failed on, naming it, whatever the other guards said", () => {
    const reply = combinedGuardReply([
      replied('push-guard', { verdict: { kind: 'allow', reason: 'cleared' } }),
      { guard: 'db-write-guard', kind: 'failed', cause: 'the config could not be read' },
    ]);
    assert.deepEqual(reply?.verdict, { kind: 'deny', reason: failedGuardReason('db-write-guard', 'the config could not be read') });
    assert.match(failedGuardReason('db-write-guard', 'boom'), /its db-write-guard guard crashed \(boom\).*must not let a call through/u);
  });
});
