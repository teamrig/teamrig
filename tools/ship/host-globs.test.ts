import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shippedHostGlobs } from './host-globs.ts';

describe('shippedHostGlobs: the repository globs of every shipped host, for the answerer clearance (T3448)', () => {
  it("names every shipped host's instruction files and project folders, not only the running host's", async () => {
    const globs = await shippedHostGlobs({}, 'linux')();
    for (const glob of ['CLAUDE.md', 'CLAUDE.local.md', '**/.claude/**', '**/.claude-plugin/**', 'GEMINI.md', '**/.agents/**']) {
      assert.ok(globs.includes(glob), `${glob} in ${globs.join(', ')}`);
    }
    assert.equal(new Set(globs).size, globs.length);
  });

  it('loads the adapters once, however often it is read', async () => {
    const read = shippedHostGlobs({}, 'linux');
    const first = read();
    assert.equal(read(), first);
    assert.deepEqual(await read(), await first);
  });
});
