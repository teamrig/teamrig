import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fieldPaths } from '../testing/field-paths.ts';
import { formatRefreshRequest, formatRefreshState, parseRefreshRequest, parseRefreshState, parseRefreshWindow, type RefreshState } from './state.ts';

const AT = '2030-01-08T10:00:00.000Z';

const EVERY_PHASE: readonly RefreshState[] = [
  { phase: 'boundary', task: 'T12', at: AT, finished: 1, ask: null },
  { phase: 'boundary', task: 'T13', at: AT, finished: 2, ask: { task: 'T12', at: AT, tokens: 262_000, handoverHash: '0123456789abcdef' } },
  { phase: 'boundary', task: 'T13', at: AT, finished: 1, ask: { task: null, at: AT, tokens: null, handoverHash: null } },
  { phase: 'idle', task: 'T12', at: AT, tokens: 120_000, finished: 2 },
  { phase: 'idle', task: 'T12', at: AT, tokens: null, finished: 0 },
  { phase: 'asked', task: 'T12', at: AT, tokens: 262_000, handoverHash: '0123456789abcdef', midTurn: false },
  { phase: 'asked', task: 'T12', at: AT, tokens: null, handoverHash: null, midTurn: false },
  { phase: 'asked', task: null, at: AT, tokens: 131_000, handoverHash: null, midTurn: true },
  { phase: 'asked', task: 'T12', at: AT, tokens: 262_000, handoverHash: null, midTurn: false, fixHash: 'fedcba9876543210' },
  { phase: 'boundary', task: 'T13', at: AT, finished: 1, ask: { task: 'T12', at: AT, tokens: 262_000, handoverHash: null, fixHash: 'fedcba9876543210' } },
  { phase: 'ready', task: 'T12', at: AT, tokens: null, noticed: false, transcript: null, claudePid: null },
  { phase: 'ready', task: 'T12', at: AT, tokens: null, noticed: true, transcript: '/claude/projects/p/s.jsonl', claudePid: 6900 },
  { phase: 'refreshed', task: 'T12', at: AT },
  { phase: 'asked', task: null, at: AT, tokens: 262_000, handoverHash: null, midTurn: false },
  { phase: 'ready', task: null, at: AT, tokens: 262_000, noticed: true, transcript: null, claudePid: null },
  { phase: 'refreshed', task: null, at: AT },
  { phase: 'asked', task: null, at: AT, tokens: 170_000, handoverHash: null, midTurn: true, compactHeld: true },
  { phase: 'ready', task: null, at: AT, tokens: 170_000, noticed: true, transcript: null, claudePid: null, compactHeld: true },
  { phase: 'boundary', task: 'T13', at: AT, finished: 1, ask: { task: null, at: AT, tokens: 170_000, handoverHash: null, compactHeld: true } },
];

describe('refresh state files', () => {
  it('reads back every phase it writes, as one versioned line', () => {
    for (const state of EVERY_PHASE) {
      const text = formatRefreshState(state);
      assert.match(text, /^\{"v":3,"phase":"[a-z]+",.*\}\n$/);
      assert.deepEqual(parseRefreshState(text), state);
    }
  });

  it('reads a damaged file, another format or an unknown phase as no state', () => {
    for (const text of [
      '',
      '{"v":1,"phase":"boundary","task":"T1"',
      '{"phase":"boundary","task":"T1","at":"x"}',
      '{"v":4,"phase":"boundary","task":"T1","at":"x"}',
      '{"v":1,"phase":"later","task":"T1","at":"x"}',
      '{"v":1,"phase":"boundary","at":"x"}',
      '{"v":1,"phase":"boundary","task":"T1"}',
      '{"v":1,"phase":"idle","task":"T1","at":"x","tokens":-1}',
      '{"v":1,"phase":"idle","task":"T1","at":"x"}',
      '{"v":1,"phase":"boundary","task":"T1","at":"x","finished":-1}',
      '{"v":1,"phase":"boundary","task":"T1","at":"x","finished":1.5}',
      '{"v":1,"phase":"idle","task":"T1","at":"x","tokens":5,"finished":"2"}',
      '{"v":1,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":7}',
      '{"v":1,"phase":"asked","task":"T1","at":"x","tokens":"1","handoverHash":null}',
      '{"v":1,"phase":"ready","task":"T1","at":"x","noticed":"no"}',
      '{"v":1,"phase":"ready","task":"T1","at":"x","noticed":true,"transcript":7}',
      '{"v":1,"phase":"ready","task":"T1","at":"x","noticed":true,"claudePid":0}',
      '{"v":1,"phase":"ready","task":"T1","at":"x","noticed":true,"claudePid":"6900"}',
      '{"v":1,"phase":"ready","task":"T1","at":"x","noticed":true,"tokens":-1}',
      '{"v":1,"phase":"boundary","task":null,"at":"x"}',
      '{"v":1,"phase":"idle","task":null,"at":"x","tokens":5}',
      '{"v":1,"phase":"asked","task":7,"at":"x","tokens":1,"handoverHash":null}',
      '{"v":1,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":null,"midTurn":"yes"}',
      '{"v":1,"phase":"boundary","task":"T1","at":"x","finished":1,"ask":7}',
      '{"v":1,"phase":"boundary","task":"T1","at":"x","finished":1,"ask":{"at":"x"}}',
      '{"v":1,"phase":"boundary","task":"T1","at":"x","finished":1,"ask":{"task":null,"at":"x","tokens":-1,"handoverHash":null}}',
      '{"v":1,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":null,"fixHash":7}',
      '{"v":1,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":null,"fixHash":null}',
      '{"v":1,"phase":"boundary","task":"T1","at":"x","finished":1,"ask":{"task":null,"at":"x","tokens":1,"handoverHash":null,"fixHash":false}}',
      '{"v":1,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":null,"compactHeld":false}',
      '{"v":1,"phase":"ready","task":"T1","at":"x","noticed":true,"compactHeld":1}',
      '{"v":1,"phase":"boundary","task":"T1","at":"x","finished":1,"ask":{"task":null,"at":"x","tokens":1,"handoverHash":null,"compactHeld":"yes"}}',
      '[1]',
    ]) {
      assert.equal(parseRefreshState(text), undefined, text);
    }
  });

  it('reads a ready state from before the transcript, process and size were recorded as having none', () => {
    assert.deepEqual(parseRefreshState('{"v":1,"phase":"ready","task":"T1","at":"x","noticed":true}'), { phase: 'ready', task: 'T1', at: 'x', tokens: null, noticed: true, transcript: null, claudePid: null });
  });

  it("reads an ask from before the mod asked within a turn as the Stop hook's", () => {
    assert.deepEqual(parseRefreshState('{"v":1,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":null}'), {
      phase: 'asked',
      task: 'T1',
      at: 'x',
      tokens: 1,
      handoverHash: null,
      midTurn: false,
    });
  });

  it('reads an ask from before a fix was asked as one with none asked (T2533)', () => {
    const asked = parseRefreshState('{"v":1,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":null,"midTurn":false}');
    assert.equal(asked !== undefined && 'fixHash' in asked, false);
    const boundary = parseRefreshState('{"v":1,"phase":"boundary","task":"T2","at":"x","finished":1,"ask":{"task":"T1","at":"x","tokens":1,"handoverHash":null}}');
    assert.deepEqual(boundary, { phase: 'boundary', task: 'T2', at: 'x', finished: 1, ask: { task: 'T1', at: 'x', tokens: 1, handoverHash: null } });
  });

  it('reads an ask or a handover from before a compaction was held back as none held (T4119)', () => {
    const asked = parseRefreshState('{"v":3,"phase":"asked","task":"T1","at":"x","tokens":1,"handoverHash":null,"midTurn":true}');
    assert.equal(asked !== undefined && 'compactHeld' in asked, false);
    const ready = parseRefreshState('{"v":3,"phase":"ready","task":"T1","at":"x","noticed":true}');
    assert.equal(ready !== undefined && 'compactHeld' in ready, false);
  });

  it('reads a boundary or a judged one from before the task count as its first task, or none counted', () => {
    assert.deepEqual(parseRefreshState('{"v":1,"phase":"boundary","task":"T1","at":"x"}'), { phase: 'boundary', task: 'T1', at: 'x', finished: 1, ask: null });
    assert.deepEqual(parseRefreshState('{"v":1,"phase":"idle","task":"T1","at":"x","tokens":5}'), { phase: 'idle', task: 'T1', at: 'x', tokens: 5, finished: 0 });
  });

  it('reads back a request, and a damaged one as none', () => {
    const request = { by: 'lead', at: AT };
    assert.deepEqual(parseRefreshRequest(formatRefreshRequest(request)), request);
    assert.equal(parseRefreshRequest('{"v":1,"by":"lead"}'), undefined);
    assert.equal(parseRefreshRequest('{"v":1,"at":"x"}'), undefined);
    assert.equal(parseRefreshRequest('{"v":2,"by":"lead","at":"x"}'), undefined);
    assert.equal(parseRefreshRequest('nope'), undefined);
  });
});

describe('the baseline field ', () => {
  it('round-trips a measured or pending baseline, reads a file without one as none, and refuses a bad one', () => {
    for (const state of [
      { phase: 'refreshed', task: 'T1', at: '2030-01-08T10:00:00.000Z', baseline: null },
      { phase: 'refreshed', task: null, at: '2030-01-08T10:00:00.000Z', baseline: 130_000 },
      { phase: 'idle', task: 'T1', at: '2030-01-08T10:00:00.000Z', tokens: 140_000, finished: 2, baseline: 130_000 },
      { phase: 'boundary', task: 'T1', at: '2030-01-08T10:00:00.000Z', finished: 1, ask: null, baseline: null },
      { phase: 'idle', task: 'T1', at: '2030-01-08T10:00:00.000Z', tokens: null, finished: 0 },
    ] satisfies RefreshState[]) {
      assert.deepEqual(parseRefreshState(formatRefreshState(state)), state, `${state.phase} ${String('baseline' in state ? state.baseline : 'none')}`);
    }
    assert.equal(parseRefreshState(formatRefreshState({ phase: 'refreshed', task: 'T1', at: 'x' }).replace('}', ',"baseline":-1}')), undefined);
  });
});

describe('the state file format', () => {
  it('writes format 3, reads formats 1 and 2 as files with no baseline, and pins the fields of the format', () => {
    const old = '{"v":1,"phase":"idle","task":"T1","at":"x","tokens":5,"finished":2}';
    assert.deepEqual(parseRefreshState(old), { phase: 'idle', task: 'T1', at: 'x', tokens: 5, finished: 2 });
    const second = '{"v":2,"phase":"idle","task":"T1","at":"x","tokens":5,"finished":2,"baseline":4}';
    assert.deepEqual(parseRefreshState(second), { phase: 'idle', task: 'T1', at: 'x', tokens: 5, finished: 2, baseline: 4 });
    const state: RefreshState = { phase: 'boundary', task: 'T1', at: AT, finished: 1, ask: { task: 'T0', at: AT, tokens: 1, handoverHash: 'h', fixHash: 'f' }, baseline: 7 };
    const written = JSON.parse(formatRefreshState(state));
    assert.deepEqual(fieldPaths(written), ['ask.at', 'ask.fixHash', 'ask.handoverHash', 'ask.task', 'ask.tokens', 'at', 'baseline', 'finished', 'phase', 'task', 'v']);
  });
});

describe("an older release's largeWindow field", () => {
  it('is ignored on every phase, whatever its value, so one threshold holds for every window', () => {
    for (const phase of EVERY_PHASE) {
      for (const largeWindow of ['true', 'false', '"yes"']) {
        const text = formatRefreshState(phase).replace(/}(\s*)$/, `,"largeWindow":${largeWindow}}$1`);
        const read = parseRefreshState(text);
        assert.deepEqual(read, phase, `${phase.phase} ${largeWindow}`);
        assert.equal(read !== undefined && 'largeWindow' in read, false);
      }
    }
  });

  it('is not written back: a state read from such a file writes none', () => {
    const live = '{"v":3,"phase":"idle","task":"T3","at":"2030-01-08T10:00:00.000Z","tokens":140000,"finished":1,"baseline":122000,"largeWindow":true}';
    const read = parseRefreshState(live);
    assert.deepEqual(read, { phase: 'idle', task: 'T3', at: AT, tokens: 140_000, finished: 1, baseline: 122_000 });
    assert.equal(read === undefined ? undefined : formatRefreshState(read).includes('largeWindow'), false);
  });
});

describe('the context window fields (#1543)', () => {
  it('round-trip the window last reported and the one last warned on beside every phase, in format 3 still', () => {
    for (const phase of EVERY_PHASE) {
      const text = formatRefreshState(phase, { window: 1_000_000, windowWarned: 200_000 });
      assert.equal(JSON.parse(text).v, 3, phase.phase);
      assert.deepEqual(parseRefreshState(text), phase, phase.phase);
      assert.deepEqual(parseRefreshWindow(text), { window: 1_000_000, windowWarned: 200_000 }, phase.phase);
    }
  });

  it('keep a window with no phase yet, which reads as no state, as it does for a release from before them', () => {
    const text = formatRefreshState(undefined, { window: 1_000_000 });
    assert.equal(parseRefreshState(text), undefined);
    assert.deepEqual(parseRefreshWindow(text), { window: 1_000_000 });
  });

  it('read as no window reported from a file without them, a damaged value, another format or no file', () => {
    assert.deepEqual(parseRefreshWindow(formatRefreshState(EVERY_PHASE[0])), {});
    assert.deepEqual(parseRefreshWindow('{"v":3,"phase":"refreshed","task":null,"at":"x","window":"1M","windowWarned":0}'), {});
    assert.deepEqual(parseRefreshWindow('{"v":3,"window":-200000,"windowWarned":1.5}'), {});
    assert.deepEqual(parseRefreshWindow('{"v":4,"window":1000000}'), {});
    assert.deepEqual(parseRefreshWindow('not json'), {});
  });

  it('are written after the phase, and only when given', () => {
    const state: RefreshState = { phase: 'refreshed', task: null, at: AT };
    assert.deepEqual(Object.keys(JSON.parse(formatRefreshState(state, { window: 200_000 }))), ['v', 'phase', 'task', 'at', 'window']);
    assert.deepEqual(Object.keys(JSON.parse(formatRefreshState(state))), ['v', 'phase', 'task', 'at']);
  });
});
