import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionLauncher, SessionStart } from '../../plugin-api/index.ts';
import { bind, runCases } from '../contract.ts';
import { LAUNCHER_CONTRACT, nothingLauncher, type LauncherSubject } from './launcher.ts';

const CASE = 'launcher.launch-args';

/** Each part that is set as `--<part> <value>`, the prompt last: the spelling a well-behaved host might choose. */
function spelled(start: SessionStart): readonly string[] {
  const parts = [['--model', start.model], ['--effort', start.effort], ['--settings', start.settingsFile], ['--resume', start.resume], ['--name', start.name]] as const;
  return [...parts.flatMap(([flag, value]) => (value === undefined ? [] : [flag, value])), ...(start.prompt === undefined ? [] : ['--', start.prompt])];
}

/** A launcher that starts sessions with `launchArgs`; the rest of the port is the nothing liar's, which this case never asks. */
function launcherWith(launchArgs: SessionLauncher['launchArgs']): LauncherSubject {
  const { world, port } = nothingLauncher();
  return { world, port: (env) => ({ ...port(env), launchArgs }) };
}

async function outcomeOf(subject: LauncherSubject): Promise<string> {
  const results = await runCases(bind({ contract: LAUNCHER_CONTRACT, make: () => subject }).cases.filter((one) => one.id === CASE));
  assert.equal(results.length, 1, `the contract has no case ${CASE}`);
  return results[0]?.outcome.kind ?? 'missing';
}

describe('the launcher contract, launch-args', () => {
  it('passes a launcher that spells every part it is asked as one argument', async () => {
    assert.equal(await outcomeOf(launcherWith(spelled)), 'passed');
  });

  it('fails a launcher that drops the settings file, so the skill listing never reaches the session (T4980)', async () => {
    assert.equal(await outcomeOf(launcherWith((start) => spelled({ ...start, settingsFile: undefined }))), 'failed');
  });
});
