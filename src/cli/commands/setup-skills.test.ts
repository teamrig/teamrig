import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadShippedHosts, type HostSource } from '../../composition/host-ports.ts';
import { isUnsupported } from '../../ports/host/index.ts';
import { hostDeps } from '../../testing/adapter-deps.ts';
import { CliHarness, type RunOptions } from '../../testing/cli-harness.ts';
import { EXIT } from '../runtime.ts';

/** The quiet world's CLI runs from /opt/teamrig/dist/cli/main.js, so its plugin root is /opt/teamrig. */
const PLUGIN_SKILLS = '/opt/teamrig/skills';
const CODEX_HOME = '/srv/codex';
const TARGET = '/srv/codex/skills/teamrig';
const GUIDE = '---\nname: teamrig-guide\ndescription: the guide\n---\n# Guide\n';
const SETUP = '---\nname: team-setup\ndescription: the setup\n---\n# Setup\n';
const COMMANDS = '# Commands\n';

const shipped = Object.values(await loadShippedHosts(hostDeps().run)).map((entry) => entry.ports);
const codex: HostSource | undefined = shipped.find((source) => {
  const { pluginSkills } = source(hostDeps());
  return !isUnsupported(pluginSkills) && pluginSkills.host === 'codex';
});

function options(over: RunOptions = {}): RunOptions {
  assert.ok(codex, 'no shipped host keeps a skills folder of the person');
  return { shippedHosts: { 'codex-cli': { ports: codex, sessionVariables: { marks: [], identity: [] } } }, env: { CODEX_HOME }, ...over };
}

async function kitWithPlugin(): Promise<CliHarness> {
  const kit = new CliHarness();
  await kit.files.write(`${PLUGIN_SKILLS}/teamrig-guide/SKILL.md`, GUIDE);
  await kit.files.write(`${PLUGIN_SKILLS}/teamrig-guide/commands.md`, COMMANDS);
  await kit.files.write(`${PLUGIN_SKILLS}/team-setup/SKILL.md`, SETUP);
  return kit;
}

function targetFiles(kit: CliHarness): readonly string[] {
  return kit.files.paths().filter((path) => path.startsWith(`${TARGET}/`));
}

describe('teamrig setup skills --host codex', () => {
  it('previews the counts without --yes and writes nothing', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'skills', '--host', 'codex'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.deepEqual(result.stdout, [`PREVIEW nothing written (add --yes to write) ${TARGET}: inserted 3, unchanged 0, changed 0, removed 0`]);
    assert.deepEqual(targetFiles(kit), []);
  });

  it('copies every skill file as the plugin ships it, says to start a new session, and finds nothing to do on a re-run', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'skills', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.equal(result.stdout[0], `WROTE ${TARGET}: inserted 3, unchanged 0, changed 0, removed 0`);
    assert.match(result.stdout[1] ?? '', /^ {2}NOTE .*new Codex session/u);
    assert.equal(kit.files.get(`${TARGET}/teamrig-guide/SKILL.md`), GUIDE);
    assert.equal(kit.files.get(`${TARGET}/teamrig-guide/commands.md`), COMMANDS);
    assert.equal(kit.files.get(`${TARGET}/team-setup/SKILL.md`), SETUP);

    const again = await kit.run(['setup', 'skills', '--host', 'codex', '--yes'], options());
    assert.deepEqual(again.stdout, [`UNCHANGED ${TARGET}: teamrig's skills are already in it (inserted 0, unchanged 3, changed 0, removed 0)`]);
  });

  it('after an update rewrites a changed skill, drops one the plugin no longer ships, and keeps the old folder', async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(`${TARGET}/teamrig-guide/SKILL.md`, GUIDE);
    await kit.files.write(`${TARGET}/teamrig-guide/commands.md`, '# Old commands\n');
    await kit.files.write(`${TARGET}/retired/SKILL.md`, '# Retired\n');
    const result = await kit.run(['setup', 'skills', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', /^WROTE \/srv\/codex\/skills\/teamrig: inserted 1, unchanged 1, changed 1, removed 1; the old folder is at (.*\/backups\/codex-skills-\d{8}T\d{9}Z)$/u);
    const backup = /the old folder is at (.*)$/u.exec(result.stdout[0] ?? '')?.[1];
    assert.ok(backup);
    assert.equal(kit.files.get(`${backup}/retired/SKILL.md`), '# Retired\n');
    assert.equal(kit.files.get(`${backup}/teamrig-guide/commands.md`), '# Old commands\n');
    assert.deepEqual(targetFiles(kit), [`${TARGET}/team-setup/SKILL.md`, `${TARGET}/teamrig-guide/SKILL.md`, `${TARGET}/teamrig-guide/commands.md`]);
    assert.equal(kit.files.get(`${TARGET}/teamrig-guide/commands.md`), COMMANDS);
  });

  it('previews a change without --yes, leaving the folder as it was', async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(`${TARGET}/retired/SKILL.md`, '# Retired\n');
    const result = await kit.run(['setup', 'skills', '--host', 'codex'], options());
    assert.deepEqual(result.stdout, [`PREVIEW nothing written (add --yes to write) ${TARGET}: inserted 3, unchanged 0, changed 0, removed 1`]);
    assert.deepEqual(targetFiles(kit), [`${TARGET}/retired/SKILL.md`]);
  });

  it('refuses a host name no shipped host answers to, naming those that do', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'skills', '--host', 'other'], options());
    assert.equal(result.code, EXIT.refused);
    assert.deepEqual(result.stdout, ['REFUSED no host named other keeps a skills folder of yours teamrig copies its skills into (the hosts that keep one: codex)']);
  });

  it("refuses when the plugin's skills folder holds no file", async () => {
    const kit = new CliHarness();
    const result = await kit.run(['setup', 'skills', '--host', 'codex'], options());
    assert.equal(result.code, EXIT.refused);
    assert.deepEqual(result.stdout, ["REFUSED the plugin's skills folder /opt/teamrig/skills holds no file; nothing written"]);
  });

  it("refuses a run from anything but the plugin's built entry script", async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'skills', '--host', 'codex'], options({ self: { node: '/usr/bin/node', script: '/work/teamrig/src/cli/main.ts', execArgv: [] } }));
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED setup skills runs from the installed plugin's dist\/cli\/main\.js, not \/work\/teamrig\/src\/cli\/main\.ts/u);
    assert.deepEqual(targetFiles(kit), []);
  });

  it('needs --host', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'skills'], options());
    assert.equal(result.code, EXIT.usage);
  });
});
