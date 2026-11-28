import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { featuresOf } from '../../plugin-api/index.ts';
import { bind, runCases } from '../contract.ts';
import { entryOf, kitProblems } from '../kit.ts';
import { nothingReads, READS_LIES, referenceReads, yesReads, type ReadsLie, type ReadsOptions } from './reads-reference.ts';
import { TRACKER_READS_CONTRACT } from './reads.ts';

/** The ids of the cases a tracker's reads built with `options` fail, in the contract's order. */
async function failedBy(options: ReadsOptions = {}): Promise<readonly string[]> {
  const results = await runCases(bind({ contract: TRACKER_READS_CONTRACT, make: () => referenceReads(options) }).cases);
  return results.filter((result) => result.outcome.kind === 'failed').map((result) => result.id.slice('tracker-reads.'.length));
}

/** The one case that catches each lie of the reads. */
const CAUGHT: Readonly<Record<ReadsLie, readonly string[]>> = {
  staleState: ['thread-reads-a-closed-issue'],
  dropsLabels: ['thread-reads-the-issue'],
  missingAsRead: ['thread-of-a-missing-issue-is-missing'],
  ignoresWords: ['search-finds-by-words'],
  ignoresState: ['search-keeps-to-the-state'],
  ignoresKind: ['search-of-pulls-finds-no-issue'],
  noMore: ['search-says-more'],
};

describe('the tracker reads contract', () => {
  it('passes a tracker that reads honestly', async () => {
    assert.deepEqual(await failedBy(), []);
  });

  it('holds both its liars on every feature, with well-named cases', async () => {
    assert.deepEqual(await kitProblems([entryOf(TRACKER_READS_CONTRACT)]), []);
    assert.equal(TRACKER_READS_CONTRACT.liars.includes(yesReads) && TRACKER_READS_CONTRACT.liars.includes(nothingReads), true);
  });

  it('names only tracker rows of the registry: reading one issue, and a search', () => {
    const rows = new Set<string>(featuresOf('connector').map((row) => row.id));
    const named = entryOf(TRACKER_READS_CONTRACT).features;
    assert.deepEqual(
      named.filter((feature) => !rows.has(feature)),
      [],
    );
    assert.deepEqual(named, ['tracker.issue-read', 'tracker.search']);
  });

  for (const lie of READS_LIES) {
    it(`catches a tracker whose reads lie by ${lie}, by its one case alone`, async () => {
      assert.deepEqual(await failedBy({ lies: [lie] }), CAUGHT[lie]);
    });
  }
});
