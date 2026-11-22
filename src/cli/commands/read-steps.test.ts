import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_VERSION } from '../../config/types.ts';
import { CONFIG_MIGRATIONS, type ConfigFormat } from '../../config/migrate.ts';
import { CliHarness, TEAM } from '../../testing/cli-harness.ts';
import { problemsOf, rowsOf, served } from '../../testing/read-answers.ts';
import { EXIT } from '../runtime.ts';

const READ_STEPS = ['read', 'steps', '--json'] as const;
/** A teamrig one config format ahead of the team's file, whose migration changes nothing but the version. */
const NEXT_FORMAT: ConfigFormat = {
  version: CONFIG_VERSION + 1,
  migrations: [...CONFIG_MIGRATIONS, { from: CONFIG_VERSION, firstRelease: '9.0.0', apply: (config) => ({ config, changes: ['adds nothing new'] }) }],
};

describe('teamrig read steps', () => {
  it('serves the config format step with its preview and what the person types, while the file is older', async () => {
    const result = await new CliHarness(TEAM).run(READ_STEPS, { configFormat: NEXT_FORMAT });
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    const answer = served(result);
    assert.deepEqual([answer['document'], problemsOf(answer), answer['cuts']], ['steps', [], []]);
    const [step] = rowsOf(answer, 'steps');
    assert.deepEqual(
      [step?.['id'], step?.['title'], step?.['preview'], step?.['command']],
      ['config-format', 'teamrig needs to update your team settings', [`v${CONFIG_VERSION}→v${CONFIG_VERSION + 1}: adds nothing new`], '/teamrig steps run config-format --yes'],
    );
  });

  it('serves no step for a file in the format this teamrig writes', async () => {
    assert.deepEqual(rowsOf(served(await new CliHarness(TEAM).run(READ_STEPS)), 'steps'), []);
  });

  it('answers in full, not unchanged, once a teamrig with a newer format reads the same file', async () => {
    const kit = new CliHarness(TEAM);
    const first = served(await kit.run(READ_STEPS));
    const held = `steps=${String(first['revision'])}`;
    assert.equal(served(await kit.run([...READ_STEPS, '--unless', held]))['unchanged'], true);
    const newer = served(await kit.run([...READ_STEPS, '--unless', held], { configFormat: NEXT_FORMAT }));
    assert.deepEqual(['unchanged' in newer, rowsOf(newer, 'steps').length], [false, 1]);
  });
});
