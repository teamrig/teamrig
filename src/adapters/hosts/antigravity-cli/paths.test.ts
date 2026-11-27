import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { hostPaths } from './paths.ts';

describe("Antigravity's paths", () => {
  it('resolves verified user and project paths on linux', () => {
    const p = hostPaths('linux');
    const home = posix.join('/', 'people', 'sam');
    const proj = posix.join('/', 'work', 'app');
    assert.equal(p.home(home), posix.join(home, '.gemini', 'config'));
    assert.equal(p.userSettings(home), posix.join(home, '.gemini', 'antigravity-cli', 'settings.json'));
    assert.deepEqual(p.folderSettings(proj), []);
    assert.equal(p.worktreeRepo(proj), undefined);
    assert.equal(p.userInstructions(home), posix.join(home, '.gemini', 'GEMINI.md'));
    assert.deepEqual(p.folderInstructions(proj), [posix.join(proj, 'AGENTS.md'), posix.join(proj, 'GEMINI.md')]);
    assert.equal(p.userRules(home), posix.join(home, '.gemini', 'config', 'rules'));
    assert.equal(p.projectRules(proj), posix.join(proj, '.agents', 'rules'));
    assert.equal(p.skills(home), posix.join(home, '.gemini', 'config', 'skills'));
    assert.equal(p.projectSkills(proj), posix.join(proj, '.agents', 'skills'));
    assert.equal(p.projectAgents(proj), posix.join(proj, '.agents', 'agents'));
  });

  it('resolves verified user and project paths on win32', () => {
    const p = hostPaths('win32');
    const home = win32.join('C:', 'people', 'sam');
    const proj = win32.join('C:', 'work', 'app');
    assert.equal(p.home(home), win32.join(home, '.gemini', 'config'));
    assert.equal(p.userSettings(home), win32.join(home, '.gemini', 'antigravity-cli', 'settings.json'));
    assert.equal(p.userInstructions(home), win32.join(home, '.gemini', 'GEMINI.md'));
    assert.deepEqual(p.folderInstructions(proj), [win32.join(proj, 'AGENTS.md'), win32.join(proj, 'GEMINI.md')]);
    assert.equal(p.projectRules(proj), win32.join(proj, '.agents', 'rules'));
    assert.equal(p.projectSkills(proj), win32.join(proj, '.agents', 'skills'));
    assert.equal(p.projectAgents(proj), win32.join(proj, '.agents', 'agents'));
  });

  it('answers undefined for an unverified place instead of throwing or guessing', () => {
    const p = hostPaths('linux');
    const home = posix.join('/', 'people', 'sam');
    const proj = posix.join('/', 'work', 'app');
    const tmp = posix.join('/', 'tmp');
    assert.equal(p.worktrees(proj), undefined);
    assert.equal(p.userAgents(home), undefined);
    assert.equal(p.memoryFolder(home, proj), undefined);
    assert.equal(p.memoryIndex(home, proj), undefined);
    assert.equal(p.memoryFolders(home), undefined);
    assert.equal(p.scratchpads(tmp), undefined);
    assert.equal(p.scratchpadOf(posix.join(tmp, 't.jsonl'), tmp), undefined);
    assert.equal(p.planFile(home, 'slug'), undefined);
    assert.equal(p.shellSnapshots(home), undefined);
    assert.equal(p.transcriptsFolder(home), undefined);
    assert.equal(p.pluginsFolder(home), undefined);
  });
});
