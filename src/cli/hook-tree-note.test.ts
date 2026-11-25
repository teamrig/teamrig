import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatConfig } from '../config/load.ts';
import { APP, CLAUDE_SESSION, CliHarness, contextOf, TEAM } from '../testing/cli-harness.ts';
import { teamConfigOf } from '../testing/team-tree.ts';

/** The SessionStart context of session alpha in a home holding `kit`'s teams. */
async function startOf(kit: CliHarness): Promise<string> {
  const stdin = JSON.stringify({ session_id: CLAUDE_SESSION, cwd: APP, source: 'startup' });
  return contextOf(await kit.run(['hook', 'session-start'], { stdin, env: { TEAMRIG_SESSION: 'alpha' } }));
}

describe('the SessionStart hook on a team cut from its tree', () => {
  it('names a parent this home lacks, as a home copied without its parent meets it', async () => {
    const context = await startOf(new CliHarness({ ...TEAM, team: { id: 'app', parent: 'corp' } }));
    assert.match(context, /\nThis team's place in its tree is broken, .*team app names parent corp, which has no team config/);
    assert.match(context, /You are the `alpha` session/);
  });

  it('says nothing of it once the parent is in the home', async () => {
    const kit = new CliHarness({ ...TEAM, team: { id: 'app', parent: 'corp' } });
    await kit.files.write(teamConfigOf('corp'), formatConfig({ ...TEAM, team: { id: 'corp' } }));
    assert.doesNotMatch(await startOf(kit), /place in its tree is broken/);
  });

  it('says nothing of it for a team on its own', async () => {
    assert.doesNotMatch(await startOf(new CliHarness()), /place in its tree is broken/);
  });
});
