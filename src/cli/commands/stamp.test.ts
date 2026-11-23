import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { KIT_VERSION } from '../../core/version.ts';
import { bareHost } from '../../testing/bare-host.ts';
import { APP, CLAUDE_SESSION, CliHarness, KIT, TEAM } from '../../testing/cli-harness.ts';

const MESSAGE = join(APP, '.git', 'COMMIT_EDITMSG');
const SNAPSHOT = join(KIT, 'usage', 'live', `${CLAUDE_SESSION}.json`);
const MADE_WITH = `Made-with: teamrig ${KIT_VERSION}`;
const IN_SESSION = { CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION };

function snapshot(fields: Readonly<Record<string, string>>): string {
  return JSON.stringify({ ts: '2026-11-22T05:00:00.000Z', session_id: CLAUDE_SESSION, cwd: APP, ...fields });
}

async function harnessWith(message: string, config = TEAM): Promise<CliHarness> {
  const cli = new CliHarness(config);
  await cli.files.write(MESSAGE, message);
  return cli;
}

describe('teamrig stamp commit', () => {
  it("adds Made-with and a Made-by naming the session's program, version, model and effort from its status snapshot", async () => {
    const cli = await harnessWith('feat: add x\n\nBody.\n\nRefs: #1\n');
    await cli.files.write(SNAPSHOT, snapshot({ model: 'Opus 5.5', effort: 'high', host_version: '3.1.0' }));

    const result = await cli.run(['stamp', 'commit', MESSAGE], { env: IN_SESSION });

    assert.equal(result.code, 0);
    const madeBy = 'Made-by: Claude Code 3.1.0; model Opus 5.5; effort high';
    assert.deepEqual(result.stdout, [`STAMPED ${MADE_WITH}, ${madeBy}`]);
    assert.equal(await cli.files.read(MESSAGE), `feat: add x\n\nBody.\n\nRefs: #1\n${MADE_WITH}\n${madeBy}`);
  });

  it('takes an effort the host forces on every session over the one the snapshot read', async () => {
    const cli = await harnessWith('fix: y\n');
    await cli.files.write(SNAPSHOT, snapshot({ model: 'Opus 5.5', effort: 'high', host_version: '3.1.0' }));

    await cli.run(['stamp', 'commit', MESSAGE], { env: { ...IN_SESSION, CLAUDE_CODE_EFFORT_LEVEL: 'low' } });

    assert.match(await cli.files.read(MESSAGE) ?? '', /effort low$/);
  });

  it('writes unknown for each part a session with no snapshot, or one naming no such part, does not tell', async () => {
    const cli = await harnessWith('fix: y\n');
    await cli.run(['stamp', 'commit', MESSAGE], { env: IN_SESSION });
    assert.equal(await cli.files.read(MESSAGE), `fix: y\n\n${MADE_WITH}\nMade-by: Claude Code unknown; model unknown; effort unknown`);

    await cli.files.write(SNAPSHOT, snapshot({ model: 'Opus 5.5' }));
    await cli.run(['stamp', 'commit', MESSAGE], { env: IN_SESSION });
    assert.equal(await cli.files.read(MESSAGE), `fix: y\n\n${MADE_WITH}\nMade-by: Claude Code unknown; model Opus 5.5; effort unknown`);
  });

  it('reads no snapshot for a session id that would leave the snapshot folder', async () => {
    const cli = await harnessWith('fix: y\n');
    await cli.files.write(join(KIT, 'usage', 'x.json'), snapshot({ model: 'Opus 5.5' }));

    await cli.run(['stamp', 'commit', MESSAGE], { env: { CLAUDE_CODE_SESSION_ID: join('..', 'x') } });

    assert.match(await cli.files.read(MESSAGE) ?? '', /model unknown/);
  });

  it("stamps a commit made outside any session with Made-with alone, dropping an amended commit's old Made-by", async () => {
    const cli = await harnessWith(`fix: y\n\n${MADE_WITH}\nMade-by: Claude Code 3.1.0; model Opus 5.5; effort high\n`);

    const result = await cli.run(['stamp', 'commit', MESSAGE]);

    assert.deepEqual(result.stdout, [`STAMPED ${MADE_WITH}`]);
    assert.equal(await cli.files.read(MESSAGE), `fix: y\n\n${MADE_WITH}`);
  });

  it('names no maker on a host with no session launcher', async () => {
    const cli = await harnessWith('fix: y\n');

    await cli.run(['stamp', 'commit', MESSAGE], { env: IN_SESSION, host: () => bareHost() });

    assert.equal(await cli.files.read(MESSAGE), `fix: y\n\n${MADE_WITH}`);
  });

  it('leaves the message as written when the team sets commits.stamp false', async () => {
    const cli = await harnessWith('fix: y\n', { ...TEAM, commits: { stamp: false } });

    const result = await cli.run(['stamp', 'commit', MESSAGE], { env: IN_SESSION });

    assert.equal(result.code, 0);
    assert.deepEqual(result.stdout, ['SKIPPED commits.stamp is false: the message is left as written']);
    assert.equal(await cli.files.read(MESSAGE), 'fix: y\n');
  });

  it('fails, writing nothing, when the message file is missing', async () => {
    const cli = new CliHarness();

    const result = await cli.run(['stamp', 'commit', MESSAGE], { env: IN_SESSION });

    assert.equal(result.code, 1);
    assert.equal(await cli.files.read(MESSAGE), undefined);
  });
});
