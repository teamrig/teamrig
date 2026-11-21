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
    assert.equal(p.userAgents(home), posix.join(home, '.gemini', 'config', 'agents'));
    assert.equal(p.projectAgents(proj), posix.join(proj, '.agents', 'agents'));
    assert.deepEqual(p.secretFiles(), []);
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

  it('throws on unverified paths instead of guessing', () => {
    const p = hostPaths('linux');
    const home = posix.join('/', 'people', 'sam');
    const proj = posix.join('/', 'work', 'app');
    assert.throws(() => p.worktrees(proj), /unsupported:/);
    assert.throws(() => p.memoryFolder(home, proj), /unsupported:/);
    assert.throws(() => p.memoryIndex(home, proj), /unsupported:/);
    assert.throws(() => p.memoryFolders(home), /unsupported:/);
    assert.throws(() => p.scratchpads(posix.join('/', 'tmp')), /unsupported:/);
    assert.throws(() => p.scratchpadOf(posix.join('/', 'tmp', 't.jsonl'), posix.join('/', 'tmp')), /unsupported:/);
    assert.throws(() => p.planFile(home, 'slug'), /unsupported:/);
    assert.throws(() => p.shellSnapshots(home), /unsupported:/);
  });
});
