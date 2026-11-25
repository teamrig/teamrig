import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codexHomeOf } from './codex-home.ts';
import { codexPluginSkills } from './plugin-skills.ts';

describe('codexHomeOf', () => {
  it('is ~/.codex when CODEX_HOME is unset or blank', () => {
    assert.equal(codexHomeOf({}, 'linux')('/srv/people/ada'), '/srv/people/ada/.codex');
    assert.equal(codexHomeOf({ CODEX_HOME: '  ' }, 'linux')('/srv/people/ada'), '/srv/people/ada/.codex');
  });

  it('is the folder CODEX_HOME names, in the platform spelling otherwise', () => {
    assert.equal(codexHomeOf({ CODEX_HOME: '/srv/codex' }, 'linux')('/srv/people/ada'), '/srv/codex');
    assert.equal(codexHomeOf({}, 'win32')('E:\\people\\ada'), 'E:\\people\\ada\\.codex');
  });
});

describe('codexPluginSkills', () => {
  it("keeps teamrig's skills in a folder of its own name below Codex's skills folder, never Codex's own .system", () => {
    const port = codexPluginSkills({}, 'linux');
    assert.equal(port.host, 'codex');
    assert.equal(port.folder('/srv/people/ada'), '/srv/people/ada/.codex/skills/teamrig');
    assert.equal(codexPluginSkills({ CODEX_HOME: 'D:\\codex' }, 'win32').folder('E:\\people\\ada'),'D:\\codex\\skills\\teamrig');
  });

  it('tells the person a new session loads the new skills', () => {
    assert.deepEqual(codexPluginSkills({}, 'linux').afterWrite, ['Codex reads its skills when a session starts: start a new Codex session to load the new ones']);
  });
});
