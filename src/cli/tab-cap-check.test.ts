import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testTask } from '../testing/task.ts';
import type { TabCapExcess } from './tab-cap.ts';
import { tabCapWarnings, tabCapWarningText } from './tab-cap-check.ts';

const NAMES: ReadonlyMap<string, string> = new Map([
  ['s1', 'docs'],
  ['s2', 'ui'],
]);

function nameOf(id: string): string {
  return NAMES.get(id) ?? id;
}

const OVER: TabCapExcess = {
  open: 7,
  maxTabs: 5,
  toClose: [
    { id: 's1', top: undefined },
    { id: 's2', top: testTask({ id: 'T4', priority: 2 }) },
  ],
};

describe('tabCapWarningText', () => {
  it('names the tabs, the cap and the sessions to close in close order, by name', () => {
    assert.equal(
      tabCapWarningText('alpha', OVER, nameOf),
      'OVER-CAP team alpha has 7 tabs open, over its cap of 5 (open.headroom.maxTabs): close docs, ui in that order, lowest-ranked work first, each with teamrig close <name> --yes',
    );
  });

  it('says so when no session open is one close may close', () => {
    assert.match(tabCapWarningText('alpha', { ...OVER, toClose: [] }, nameOf), /every session open is one teamrig close never closes, so close a tab by hand or raise the cap$/);
  });
});

describe('tabCapWarnings', () => {
  it('reads nothing with no cap set', async () => {
    let reads = 0;
    const warnings = await tabCapWarnings('alpha', undefined, async () => {
      reads += 1;
      return OVER;
    }, nameOf);
    assert.deepEqual(warnings, []);
    assert.equal(reads, 0);
  });

  it('warns of nothing at or under the cap', async () => {
    assert.deepEqual(await tabCapWarnings('alpha', 5, async () => undefined, nameOf), []);
  });

  it('warns the lead once per team while the team stands over its cap', async () => {
    const [warning, ...rest] = await tabCapWarnings('alpha', 5, async () => OVER, nameOf);
    assert.deepEqual(rest, []);
    assert.equal(warning?.key, 'over-cap alpha');
    assert.equal(warning?.source, 'the tab cap check of team alpha');
    assert.equal(warning?.text, tabCapWarningText('alpha', OVER, nameOf));
  });
});
