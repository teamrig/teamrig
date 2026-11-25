import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { featuresOf } from '../../plugin-api/index.ts';
import { bind, runCases } from '../contract.ts';
import { entryOf, kitProblems } from '../kit.ts';
import { nothingTracker, referenceTracker, TRACKER_WRITES, yesTracker, type TrackerOptions, type TrackerWrite } from './reference.ts';
import { TRACKER_CONTRACT } from './tracker.ts';

/** The ids of the cases a tracker built with `options` fails, in the contract's order. */
async function failedBy(options: TrackerOptions = {}): Promise<readonly string[]> {
  const results = await runCases(bind({ contract: TRACKER_CONTRACT, make: () => referenceTracker(options) }).cases);
  return results.filter((result) => result.outcome.kind === 'failed').map((result) => result.id.slice('tracker.'.length));
}

/** The cases that catch a tracker answering one write as done without doing it. */
const CAUGHT: Readonly<Record<TrackerWrite, readonly string[]>> = {
  open: ['open-files-the-issue', 'open-numbers-differ'],
  comment: ['comment-posts-on-the-issue', 'comment-on-a-missing-issue-fails'],
  editBody: ['edit-body-replaces-only-the-body', 'edit-body-of-a-missing-issue-fails'],
  close: ['close-as-completed', 'close-as-not-planned'],
  addLabels: ['labels-added-and-taken-off'],
  removeLabel: ['labels-added-and-taken-off'],
  assign: ['assign-and-unassign'],
  unassign: ['assign-and-unassign'],
};

describe('the tracker contract', () => {
  it('passes a tracker that does every write honestly', async () => {
    assert.deepEqual(await failedBy(), []);
  });

  it('holds both its liars on every feature, with well-named cases', async () => {
    assert.deepEqual(await kitProblems([entryOf(TRACKER_CONTRACT)]), []);
    assert.equal(TRACKER_CONTRACT.liars.includes(yesTracker) && TRACKER_CONTRACT.liars.includes(nothingTracker), true);
  });

  it('names only tracker rows of the registry: the writes on an issue, its first slice', () => {
    const rows = new Set<string>(featuresOf('connector').map((row) => row.id));
    const named = entryOf(TRACKER_CONTRACT).features;
    assert.deepEqual(
      named.filter((feature) => !rows.has(feature)),
      [],
    );
    assert.deepEqual(named, ['tracker.issue-open', 'tracker.comment', 'tracker.edit-body', 'tracker.close', 'tracker.labels', 'tracker.assign']);
  });

  for (const write of TRACKER_WRITES) {
    it(`catches a tracker that answers ${write} as done without doing it, by the cases of that write alone`, async () => {
      assert.deepEqual(await failedBy({ lies: [write] }), CAUGHT[write]);
    });
  }

  it('catches a tracker that says every label is there, by the label read case alone', async () => {
    assert.deepEqual(await failedBy({ everyLabel: true }), ['label-exists-tells-each']);
  });

  it('catches a tracker that closes every issue as completed, by the not-planned case alone', async () => {
    assert.deepEqual(await failedBy({ oneReason: true }), ['close-as-not-planned']);
  });

  it('catches a tracker that writes on an issue it does not hold, by the missing-issue cases alone', async () => {
    assert.deepEqual(await failedBy({ writesAnywhere: true }), ['comment-on-a-missing-issue-fails', 'edit-body-of-a-missing-issue-fails']);
  });
});
