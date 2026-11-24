import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { formatConfig } from '../config/load.ts';
import type { JsonRecord } from '../core/guards.ts';
import { CliHarness, TEAM, TEAM_HOME, USER_HOME } from '../testing/cli-harness.ts';
import { NO_PATHS_HOST } from '../testing/host.ts';
import { EXIT } from './runtime.ts';

const SETTINGS = join(USER_HOME, '.claude', 'settings.json');
const FLAG = `from the auto mode lines check [autoMode.environment]: AUTOMODE-STALE ${SETTINGS} autoMode.environment holds team app's lines as an older config or teamrig wrote them`;
const ENDING = "so auto mode reads the team as it was. `teamrig automode install` shows the change; writing it with --yes changes the person's permission settings, the owner's call.";

/** The default team with these GitHub repositories. */
function withRepos(repos: readonly string[]): JsonRecord {
  return { ...TEAM, github: { repos } };
}

/** The lead's AUTOMODE-STALE rows. */
async function staleRows(kit: CliHarness, host?: typeof NO_PATHS_HOST): Promise<string[]> {
  const result = await kit.run(['check', '--all'], { env: { TEAMRIG_SESSION: 'lead' }, ...(host === undefined ? {} : { host }) });
  assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
  return result.stdout.filter((line) => line.includes('AUTOMODE-STALE'));
}

/** The settings' trusted route lines. */
function routesIn(kit: CliHarness): string[] {
  const parsed: unknown = JSON.parse(kit.files.get(SETTINGS) ?? '{}');
  const lines: string[] = [];
  if (typeof parsed === 'object' && parsed !== null && 'autoMode' in parsed) {
    const { autoMode } = parsed;
    if (typeof autoMode === 'object' && autoMode !== null && 'environment' in autoMode && Array.isArray(autoMode.environment)) {
      lines.push(...autoMode.environment.filter((item): item is string => typeof item === 'string'));
    }
  }
  return lines;
}

async function installed(config: JsonRecord): Promise<CliHarness> {
  const kit = new CliHarness(config);
  const result = await kit.run(['automode', 'install', '--yes']);
  assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
  return kit;
}

describe('check AUTOMODE-STALE (T5338)', () => {
  it('is quiet while the installed lines are the ones install writes now', async () => {
    assert.deepEqual(await staleRows(await installed(withRepos(['me/app']))), []);
  });

  it("flags the team's lines once a config change makes install write another line", async () => {
    const kit = await installed(withRepos(['me/app']));
    await kit.files.write(join(TEAM_HOME, 'config.json'), formatConfig(withRepos(['org/app'])));
    assert.deepEqual(await staleRows(kit), [`${FLAG} (1 of its 7 lines missing or out of date, 1 no longer written), ${ENDING}`]);
    await kit.run(['automode', 'install', '--yes']);
    assert.deepEqual(await staleRows(kit), []);
  });

  it('flags lines an older teamrig wrote with one line fewer', async () => {
    const kit = await installed(TEAM);
    const routes = routesIn(kit);
    await kit.files.write(SETTINGS, JSON.stringify({ autoMode: { environment: routes.slice(0, -1) } }));
    assert.deepEqual(await staleRows(kit), [`${FLAG} (1 of its 7 lines missing or out of date), ${ENDING}`]);
  });

  it("is quiet on a machine with none of the team's lines, an unreadable settings file, or a host whose settings teamrig does not know", async () => {
    const none = new CliHarness(TEAM);
    await none.files.write(SETTINGS, JSON.stringify({ autoMode: { environment: ['$defaults', '[teamrig shop] Protected branches: main.'] } }));
    assert.deepEqual(await staleRows(none), []);
    const broken = new CliHarness(TEAM);
    await broken.files.write(SETTINGS, '{ not json');
    assert.deepEqual(await staleRows(broken), []);
    const kit = await installed(withRepos(['me/app']));
    await kit.files.write(join(TEAM_HOME, 'config.json'), formatConfig(withRepos(['org/app'])));
    assert.deepEqual(await staleRows(kit, NO_PATHS_HOST), []);
  });
});
