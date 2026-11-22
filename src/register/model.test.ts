import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_SOURCE_IDS, IMPORT_SOURCES, isImportSource, isTrackerRef, LOCAL_REF_PREFIX } from './model.ts';

describe('import sources', () => {
  it('lists every key of the table, in its order', () => {
    assert.deepEqual([...IMPORT_SOURCE_IDS], Object.keys(IMPORT_SOURCES));
  });

  it('knows github and jira, and nothing else as a source', () => {
    assert.equal(isImportSource('github'), true);
    assert.equal(isImportSource('jira'), true);
    for (const other of ['local', 'session', '', 'GitHub', null, 7]) {
      assert.equal(isImportSource(other), false, String(other));
    }
  });
});

describe('isTrackerRef', () => {
  it("takes a ref of each import source's prefix", () => {
    assert.equal(isTrackerRef('gh:acme/web#7'), true);
    assert.equal(isTrackerRef('jira:ENG-12'), true);
  });

  it('refuses a free-text ref, a local reason, an unknown prefix and no ref', () => {
    for (const ref of ['https://example.com/x', `${LOCAL_REF_PREFIX}kept off`, 'linear:ENG-1', 'T12', 'owner call', '', null, undefined]) {
      assert.equal(isTrackerRef(ref), false, String(ref));
    }
  });
});
