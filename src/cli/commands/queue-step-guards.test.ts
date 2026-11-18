import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { queuedLineOf, refusalOf, unboundShellEventOf } from './queue-step-guards.ts';

describe('queuedLineOf (T4265)', () => {
  it('writes the line a session types to queue the words, each quoted so none is read as syntax', () => {
    assert.equal(queuedLineOf(['git', 'push', 'origin', 'main']), "teamrig queue -- 'git' 'push' 'origin' 'main'");
    assert.equal(queuedLineOf(["echo 'a' && rm -rf x"]), "teamrig queue -- 'echo '\\''a'\\'' && rm -rf x'");
  });
});

describe('refusalOf (T4265)', () => {
  it("gives a deny's reason and a block's", () => {
    assert.equal(refusalOf({ verdict: { kind: 'deny', reason: 'a force-push of main' } }), 'a force-push of main');
    assert.equal(refusalOf({ verdict: { kind: 'block', reason: 'held' } }), 'held');
  });

  it('lets through no reply, a note with no verdict and an allow', () => {
    assert.equal(refusalOf(undefined), undefined);
    assert.equal(refusalOf({ notice: 'teamrig let this push through' }), undefined);
    assert.equal(refusalOf({ verdict: { kind: 'allow', reason: 'a route' } }), undefined);
  });
});

describe('unboundShellEventOf (T4265)', () => {
  it('is a bash call about to run in the folder, from no host session', () => {
    const event = unboundShellEventOf('teamrig queue -- git push', '/repo');
    assert.equal(event.name, 'tool-start');
    assert.equal(event.session, undefined);
    assert.equal(event.cwd, '/repo');
    assert.equal(event.helper, undefined);
    assert.deepEqual(event.call?.kind === 'shell' ? [event.call.dialect, event.call.command, event.call.readings] : undefined, ['bash', 'teamrig queue -- git push', ['teamrig queue -- git push']]);
  });
});
