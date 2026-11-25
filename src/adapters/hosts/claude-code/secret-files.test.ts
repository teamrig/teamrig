import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostSecrets } from './secret-files.ts';

/** The secret files it names in every run, whatever the environment holds: the specs of a moved folder add to them. */
const SECRET_FILES_ALWAYS = ['~/.claude/.credentials.json', '~/.claude/history.jsonl', '**/.claude/settings.local.json', '**/.claude*/.credentials.json'];

describe("Claude Code's secret files", () => {
  it("names its login, its prompt history, a folder's local settings and its login in a folder named like its own as the secret files", () => {
    assert.deepEqual(hostSecrets({}, process.platform).secretFiles(), SECRET_FILES_ALWAYS);
  });

  it('names its login in any folder as a file the guard counts only where a word names it outright (T4870)', () => {
    assert.deepEqual(hostSecrets({}, process.platform).namedFiles?.(), ['**/.credentials.json']);
    assert.deepEqual(hostSecrets({ CLAUDE_CONFIG_DIR: '/cfg' }, 'linux').namedFiles?.(), ['**/.credentials.json'], 'whatever folder the variable names');
  });

  it('names its login and prompt history in the folder CLAUDE_CONFIG_DIR moves its own to as well, keeping the default place', () => {
    const always = SECRET_FILES_ALWAYS;
    const moved = (value: string, platform: NodeJS.Platform): readonly string[] => hostSecrets({ CLAUDE_CONFIG_DIR: value }, platform).secretFiles();
    assert.deepEqual(moved('/cfg', 'linux'), [...always, '/cfg/.credentials.json', '/cfg/history.jsonl']);
    assert.deepEqual(moved(' /srv/../cfg// ', 'darwin'), [...always, '/cfg/.credentials.json', '/cfg/history.jsonl'], 'trimmed and resolved');
    assert.deepEqual(moved('/', 'linux'), [...always, '/.credentials.json', '/history.jsonl']);
    assert.deepEqual(moved('C:\\agents\\cfg\\', 'win32'), [...always, 'C:/agents/cfg/.credentials.json', 'C:/agents/cfg/history.jsonl']);
    assert.deepEqual(moved('d:/', 'win32'), [...always, 'd:/.credentials.json', 'd:/history.jsonl']);
  });

  it('fits a moved folder on any drive when its Windows path names none, and reads a wildcard character of its name as that character', () => {
    const moved = (value: string, platform: NodeJS.Platform): readonly string[] => hostSecrets({ CLAUDE_CONFIG_DIR: value }, platform).secretFiles().slice(SECRET_FILES_ALWAYS.length);
    assert.deepEqual(moved('\\cfg', 'win32'), ['?:/cfg/.credentials.json', '?:/cfg/history.jsonl']);
    assert.deepEqual(moved('/agents/cfg/', 'win32'), ['?:/agents/cfg/.credentials.json', '?:/agents/cfg/history.jsonl']);
    assert.deepEqual(moved('\\\\nas\\share\\cfg', 'win32'), ['/nas/share/cfg/.credentials.json', '/nas/share/cfg/history.jsonl'], 'a network share');
    assert.deepEqual(moved('/srv/a[1]*?', 'linux'), ['/srv/a[[]1][*][?]/.credentials.json', '/srv/a[[]1][*][?]/history.jsonl']);
  });

  it('names no file for a CLAUDE_CONFIG_DIR that is blank or no absolute path on the platform', () => {
    const always = SECRET_FILES_ALWAYS;
    const values: readonly (readonly [string, NodeJS.Platform])[] = [
      ['', 'linux'],
      ['  ', 'linux'],
      ['cfg', 'linux'],
      ['~/cfg', 'linux'],
      ['./cfg', 'darwin'],
      ['C:\\cfg', 'linux'],
      ['cfg', 'win32'],
      ['C:cfg', 'win32'],
      ['~\\cfg', 'win32'],
    ];
    for (const [value, platform] of values) {
      assert.deepEqual(hostSecrets({ CLAUDE_CONFIG_DIR: value }, platform).secretFiles(), always, `${JSON.stringify(value)} on ${platform}`);
    }
  });
});
