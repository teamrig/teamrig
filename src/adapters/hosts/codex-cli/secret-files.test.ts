import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { codexSecretFiles } from './secret-files.ts';

/** The secret files it names in every run, whatever the environment holds: a moved folder adds to them. */
const ALWAYS = ['~/.codex/auth.json', '~/.codex/history.jsonl', '~/.codex/secrets/**', '**/.codex*/auth.json'];

describe("Codex CLI's secret files", () => {
  it('names its login, its prompt history, its secret store and its login in a folder named like its own', () => {
    assert.deepEqual(codexSecretFiles({}, 'linux'), ALWAYS);
  });

  it('names them in the folder CODEX_HOME moves its own to as well, keeping the default place', () => {
    assert.deepEqual(codexSecretFiles({ CODEX_HOME: '/cfg/' }, 'linux'), [...ALWAYS, '/cfg/auth.json', '/cfg/history.jsonl', '/cfg/secrets/**']);
    assert.deepEqual(codexSecretFiles({ CODEX_HOME: 'C:\\agents\\codex' }, 'win32'), [
      ...ALWAYS,
      'C:/agents/codex/auth.json',
      'C:/agents/codex/history.jsonl',
      'C:/agents/codex/secrets/**',
    ]);
  });

  it('names no moved file for a CODEX_HOME that is blank or no absolute path on the platform', () => {
    assert.deepEqual(codexSecretFiles({ CODEX_HOME: '  ' }, 'linux'), ALWAYS);
    assert.deepEqual(codexSecretFiles({ CODEX_HOME: 'codex' }, 'win32'), ALWAYS);
  });

  it('reads the moved folder from CODEX_HOME alone, not from the variable that moves Claude Code', () => {
    assert.deepEqual(codexSecretFiles({ CLAUDE_CONFIG_DIR: '/cfg' }, 'linux'), ALWAYS);
  });
});
