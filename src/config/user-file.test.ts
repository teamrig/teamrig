import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryFiles } from '../testing/memory-files.ts';
import { formatIssue } from './reader.ts';
import { readUserFile, userFilePath } from './user-file.ts';

const KIT_HOME = '/home/someone/.teamrig';

function filesWith(text: string): MemoryFiles {
  return new MemoryFiles({ [userFilePath(KIT_HOME)]: text });
}

async function issuesOf(text: string): Promise<string[]> {
  return (await readUserFile(filesWith(text), KIT_HOME)).issues.map(formatIssue);
}

describe('readUserFile', () => {
  it('lives at user.json in the kit home', () => {
    assert.equal(userFilePath(KIT_HOME).replaceAll('\\', '/'), `${KIT_HOME}/user.json`);
  });

  it('sets nothing when there is no file', async () => {
    assert.deepEqual(await readUserFile(new MemoryFiles(), KIT_HOME), { levelNames: null, issues: [] });
  });

  it('sets nothing for a file with no levels', async () => {
    assert.deepEqual(await readUserFile(filesWith('{}'), KIT_HOME), { levelNames: null, issues: [] });
  });

  it('reads a preset and a map of every level', async () => {
    assert.equal((await readUserFile(filesWith('{"levels":{"names":"linear"}}'), KIT_HOME)).levelNames, 'linear');
    const map = {
      goal: { singular: 'Theme', plural: 'Themes' },
      feature: { singular: 'Epic', plural: 'Epics' },
      task: { singular: 'Ticket', plural: 'Tickets' },
      subtask: { singular: 'Step', plural: 'Steps' },
    };
    const read = await readUserFile(filesWith(JSON.stringify({ levels: { names: map } })), KIT_HOME);
    assert.deepEqual(read, { levelNames: map, issues: [] });
  });

  it('refuses a names value the team config would refuse, and sets nothing', async () => {
    const read = await readUserFile(filesWith('{"levels":{"names":"trello"}}'), KIT_HOME);
    assert.equal(read.levelNames, null);
    assert.deepEqual(read.issues.map((issue) => issue.path), ['levels.names']);
  });

  it('refuses any key it does not hold, so the file keeps names only, yet still reads the names', async () => {
    const read = await readUserFile(filesWith('{"token":"x","levels":{"names":"jira","note":"y"}}'), KIT_HOME);
    assert.equal(read.levelNames, 'jira');
    assert.deepEqual(read.issues.map((issue) => issue.path), ['token', 'levels.note']);
  });

  it('refuses levels that is no object', async () => {
    assert.deepEqual((await readUserFile(filesWith('{"levels":3}'), KIT_HOME)).issues.map((issue) => issue.path), ['levels']);
  });

  it('refuses a file that is not JSON or not an object, naming the file', async () => {
    const broken = await issuesOf('{levels');
    assert.equal(broken.length, 1);
    assert.match(broken[0] ?? '', /^user\.json.*is not valid JSON/);
    assert.equal((await issuesOf('[]')).length, 1);
    assert.match((await issuesOf('"jira"'))[0] ?? '', /is not a JSON object/);
  });
});
