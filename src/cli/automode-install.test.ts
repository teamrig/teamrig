import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { kitLines, kitTag } from '../automode/lines.ts';
import { formatConfig } from '../config/load.ts';
import type { JsonRecord } from '../core/guards.ts';
import { homeRelative } from '../core/paths.ts';
import { ALLOW_COMMANDS, allowRulesOf } from '../permissions/allow-sync.ts';
import { CliHarness, KIT, TEAM, TEAM_HOME, USER_HOME } from '../testing/cli-harness.ts';
import { NO_PATHS_HOST, SESSIONS_ONLY_HOST } from '../testing/host.ts';
import { shippedPermissions } from '../testing/shipped-permissions.ts';
import { EXIT } from './runtime.ts';

const PERMISSIONS = shippedPermissions();
const SETTINGS = join(USER_HOME, '.claude', 'settings.json');
const BACKUP = join(KIT, 'backups', 'claude-settings.json');
/** The record of the allow rules install wrote. */
const RECORD = join(KIT, 'synced-allow-rules.json');
const WHERE = `${SETTINGS} ${PERMISSIONS.routesSetting}`;
/** teamrig's own allow rules, which every install syncs after the routes, and the lines that add them. */
const RULES = allowRulesOf(PERMISSIONS, ALLOW_COMMANDS);
const ADD_RULES = RULES.map((rule) => `  ADD ${SETTINGS} ${PERMISSIONS.allowSetting}: ${rule}`);
const TAG = kitTag('app');
/** The default team's lines: team `app`, lead `lead`, the shipped push guard. */
const LINES = kitLines({
  team: 'app',
  home: homeRelative(TEAM_HOME, USER_HOME),
  lead: 'lead',
  pushGuard: { protectedBranches: ['main', 'master'], pushToProtected: 'ask' },
  githubRepos: [],
  deliveryRepos: [],
});
const OWN = 'Trusted repo: github.com/me/app';
const OTHER_TEAM = '[teamrig shop] Protected branches: main.';

async function withSettings(text: string | undefined, config = TEAM): Promise<CliHarness> {
  const kit = new CliHarness(config);
  if (text !== undefined) {
    await kit.files.write(SETTINGS, text);
  }
  return kit;
}

function settingsIn(kit: CliHarness): unknown {
  const text = kit.files.get(SETTINGS);
  return text === undefined ? undefined : JSON.parse(text);
}

function recordIn(kit: CliHarness): unknown {
  const text = kit.files.get(RECORD);
  return text === undefined ? undefined : JSON.parse(text);
}

function added(lines: readonly string[]): string[] {
  return lines.map((line) => `  ADD ${WHERE}: ${line}`);
}

function removed(lines: readonly string[]): string[] {
  return lines.map((line) => `  REMOVE ${WHERE}: ${line}`);
}

describe('teamrig automode install', () => {
  it("refuses on a host whose folders teamrig does not know, with the host's own reason, reading and writing nothing", async () => {
    const original = formatConfig({ theme: 'dark' });
    const kit = await withSettings(original);
    const result = await kit.run(['automode', 'install', '--yes'], { host: NO_PATHS_HOST });
    assert.deepEqual([result.code, result.stdout], [EXIT.refused, ['REFUSED no folder of the host is known']]);
    assert.deepEqual([kit.files.get(SETTINGS), kit.files.get(BACKUP)], [original, undefined]);
  });

  it('previews the lines after "$defaults" on a machine with no list, and writes nothing without --yes', async () => {
    const kit = await withSettings(undefined);
    const result = await kit.run(['automode', 'install']);
    assert.deepEqual([result.code, result.stdout], [EXIT.ok, ['PREVIEW nothing written (add --yes to write)', ...added(['$defaults', ...LINES]), ...ADD_RULES]]);
    assert.equal(kit.files.get(SETTINGS), undefined);
  });

  it('with --yes writes the list and the allow rules, and a second run finds nothing to change', async () => {
    const kit = await withSettings(undefined);
    const result = await kit.run(['automode', 'install', '--yes']);
    assert.deepEqual(result.stdout, ['WROTE the changes below', ...added(['$defaults', ...LINES]), ...ADD_RULES]);
    assert.deepEqual(settingsIn(kit), { autoMode: { environment: ['$defaults', ...LINES] }, permissions: { allow: RULES } });
    assert.deepEqual((await kit.run(['automode', 'install', '--yes'])).stdout, [`UNCHANGED ${SETTINGS}: team app's lines and teamrig's allow rules are already there`]);
  });

  it('replaces stale team lines where they were, keeping the old file and every other line and key', async () => {
    const original = formatConfig({ theme: 'dark', autoMode: { allow: ['x'], environment: [OWN, `${TAG}an old line`, OTHER_TEAM] } });
    const kit = await withSettings(original);
    const result = await kit.run(['automode', 'install', '--yes']);
    assert.deepEqual(result.stdout, [
      `WROTE the changes below; the old settings file is at ${BACKUP}`,
      ...removed([`${TAG}an old line`]),
      ...added(LINES),
      ...ADD_RULES,
    ]);
    assert.deepEqual(settingsIn(kit), { theme: 'dark', autoMode: { allow: ['x'], environment: [OWN, ...LINES, OTHER_TEAM] }, permissions: { allow: RULES } });
    assert.equal(kit.files.get(BACKUP), original);
  });

  it("fills the lines from the team's config: its lead and push guard", async () => {
    const kit = await withSettings(undefined, { ...TEAM, roles: { lead: 'alpha' }, pushGuard: { protectedBranches: ['trunk'], pushToProtected: 'lead' } });
    const result = await kit.run(['automode', 'install']);
    assert.match(result.stdout[2] ?? '', /\[teamrig app\] Protected branches: trunk\. A normal push to one goes through only for the lead \(session alpha\)/);
  });

  it("names the team's repositories in the delivery line, and a re-run after a rename swaps that line for the new names", async () => {
    const delivery = (text: string): string | undefined => text.split('\n').find((line) => line.includes('Delivery: every session of team app'));
    const repos = (names: readonly string[]): JsonRecord => ({
      ...TEAM,
      github: { repos: names },
      delivery: { repos: { app: { mainCheckout: 'checkouts/app' } } },
    });
    const kit = await withSettings(undefined, repos(['me/app', 'me/docs']));
    await kit.run(['automode', 'install', '--yes']);
    const before = delivery(kit.files.get(SETTINGS) ?? '') ?? '';
    assert.match(before, /a worktree of app into its default branch/);
    assert.match(before, /a pull request of me\/app, me\/docs only when one task holds it/);
    await kit.files.write(join(TEAM_HOME, 'config.json'), formatConfig(repos(['org/app', 'org/docs'])));
    const result = await kit.run(['automode', 'install', '--yes']);
    const removedLine = result.stdout.find((line) => line.startsWith('  REMOVE') && line.includes('Delivery:')) ?? '';
    const addedLine = result.stdout.find((line) => line.startsWith('  ADD') && line.includes('Delivery:')) ?? '';
    assert.match(removedLine, /me\/app, me\/docs/);
    assert.match(addedLine, /org\/app, org\/docs/);
    assert.doesNotMatch(kit.files.get(SETTINGS) ?? '', /me\/app/);
  });

  it('names a team folder under the user home with ~/', async () => {
    const kitHome = join(USER_HOME, '.teamrig');
    const kit = new CliHarness(null);
    await kit.files.write(join(kitHome, 'teams', 'app', 'config.json'), formatConfig(TEAM));
    const result = await kit.run(['automode', 'install'], { env: { TEAMRIG_HOME: kitHome } });
    assert.match(result.stdout[3] ?? '', /they write only under ~\/\.teamrig\/teams\/app\/\.$/);
  });

  it('refuses a list that is not strings and writes nothing', async () => {
    const original = formatConfig({ autoMode: { environment: [OWN, 3] } });
    const kit = await withSettings(original);
    const result = await kit.run(['automode', 'install', '--yes']);
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED autoMode\.environment is not a list of strings/);
    assert.equal(kit.files.get(SETTINGS), original);
    assert.equal(kit.files.get(BACKUP), undefined);
  });

  it('records the rules it wrote, and never takes over or removes one the person wrote', async () => {
    const own = 'Bash(teamrig list *)';
    const kit = await withSettings(formatConfig({ permissions: { allow: [own] } }));
    await kit.run(['automode', 'install', '--yes']);
    const written = RULES.filter((rule) => rule !== own);
    assert.deepEqual(recordIn(kit), { [SETTINGS]: written });
    assert.deepEqual(settingsIn(kit), { permissions: { allow: [own, ...written] }, autoMode: { environment: ['$defaults', ...LINES] } });
  });

  it('on an update takes out a recorded rule no longer synced, leaving the same rule the person wrote', async () => {
    const retired = 'Bash(teamrig budget *)';
    const theirs = 'PowerShell(teamrig budget *)';
    const kit = await withSettings(formatConfig({ autoMode: { environment: ['$defaults', ...LINES] }, permissions: { allow: [retired, theirs, ...RULES] } }));
    await kit.files.write(RECORD, formatConfig({ [SETTINGS]: [retired, ...RULES] }));
    const result = await kit.run(['automode', 'install', '--yes']);
    assert.deepEqual(result.stdout, [`WROTE the changes below; the old settings file is at ${BACKUP}`, `  REMOVE ${SETTINGS} ${PERMISSIONS.allowSetting}: ${retired}`]);
    assert.deepEqual(settingsIn(kit), { autoMode: { environment: ['$defaults', ...LINES] }, permissions: { allow: [theirs, ...RULES] } });
    assert.deepEqual(recordIn(kit), { [SETTINGS]: RULES });
  });

  it('writes no record without --yes', async () => {
    const kit = await withSettings(undefined);
    await kit.run(['automode', 'install']);
    assert.equal(kit.files.get(RECORD), undefined);
  });

  it('refuses a record that is not a list of rules per file, writing nothing', async () => {
    const original = formatConfig({ theme: 'dark' });
    const kit = await withSettings(original);
    await kit.files.write(RECORD, formatConfig({ [SETTINGS]: 'Bash(teamrig list *)' }));
    const result = await kit.run(['automode', 'install', '--yes']);
    assert.deepEqual([result.code, result.stdout], [EXIT.refused, [`REFUSED ${RECORD}: ${SETTINGS} is not a list of strings; nothing written`]]);
    assert.deepEqual([kit.files.get(SETTINGS), kit.files.get(BACKUP)], [original, undefined]);
  });

  it('refuses an allow setting that is not a list of strings, writing nothing', async () => {
    const original = formatConfig({ permissions: { allow: ['Read', 3] } });
    const kit = await withSettings(original);
    const result = await kit.run(['automode', 'install', '--yes']);
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED permissions\.allow/);
    assert.deepEqual([kit.files.get(SETTINGS), kit.files.get(BACKUP), kit.files.get(RECORD)], [original, undefined, undefined]);
  });

  it('refuses outside a team', async () => {
    const kit = new CliHarness(null, null);
    const result = await kit.run(['automode', 'install']);
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED no team here/);
  });

  it('refuses on a host that keeps no permission rule, install and uninstall alike, writing nothing', async () => {
    const original = formatConfig({ autoMode: { environment: [OWN, ...LINES] } });
    for (const command of ['install', 'uninstall']) {
      const kit = await withSettings(original);
      const result = await kit.run(['automode', command, '--yes'], { host: SESSIONS_ONLY_HOST });
      assert.deepEqual([result.code, result.stdout], [EXIT.refused, ['REFUSED no permission rule is kept']], command);
      assert.deepEqual([kit.files.get(SETTINGS), kit.files.get(BACKUP)], [original, undefined], command);
    }
  });
});

describe('teamrig automode uninstall', () => {
  it("takes out only the team's lines, and drops a list and an autoMode left with nothing of their own", async () => {
    const kit = await withSettings(formatConfig({ theme: 'dark', autoMode: { environment: ['$defaults', ...LINES] } }));
    const preview = await kit.run(['automode', 'uninstall']);
    assert.deepEqual(preview.stdout, ['PREVIEW nothing written (add --yes to write)', ...removed(LINES)]);
    const result = await kit.run(['automode', 'uninstall', '--yes']);
    assert.deepEqual(result.stdout, [`WROTE the changes below; the old settings file is at ${BACKUP}`, ...removed(LINES)]);
    assert.deepEqual(settingsIn(kit), { theme: 'dark' });
  });

  it("keeps the person's own lines and another team's", async () => {
    const kit = await withSettings(formatConfig({ autoMode: { environment: [OWN, ...LINES, OTHER_TEAM] } }));
    await kit.run(['automode', 'uninstall', '--yes']);
    assert.deepEqual(settingsIn(kit), { autoMode: { environment: [OWN, OTHER_TEAM] } });
  });

  it("leaves teamrig's allow rules and their record, which every team on the machine shares", async () => {
    const kit = await withSettings(formatConfig({ autoMode: { environment: ['$defaults', ...LINES] }, permissions: { allow: RULES } }));
    const record = formatConfig({ [SETTINGS]: RULES });
    await kit.files.write(RECORD, record);
    await kit.run(['automode', 'uninstall', '--yes']);
    assert.deepEqual(settingsIn(kit), { permissions: { allow: RULES } });
    assert.equal(kit.files.get(RECORD), record);
  });

  it('changes nothing when the team has no lines there', async () => {
    const kit = await withSettings(formatConfig({ autoMode: { environment: [OWN] } }));
    const result = await kit.run(['automode', 'uninstall', '--yes']);
    assert.deepEqual([result.code, result.stdout], [EXIT.ok, [`UNCHANGED ${SETTINGS}: team app has no lines there`]]);
    assert.equal(kit.files.get(BACKUP), undefined);
  });
});
