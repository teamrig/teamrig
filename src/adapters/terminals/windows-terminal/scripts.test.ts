import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { FOCUS_SCRIPT, KEEP_FOCUS_SCRIPT } from './scripts.ts';

const SCRIPTS = [
  ['the focus script', FOCUS_SCRIPT],
  ['the keep-focus script', KEEP_FOCUS_SCRIPT],
] as const;

describe("Windows Terminal's UI Automation scripts", () => {
  it('keep the progress record of their first module load off the caller', () => {
    for (const [name, script] of SCRIPTS) {
      assert.match(script, /^\$ProgressPreference = 'SilentlyContinue'$/m, name);
    }
  });

  // Parsed only, never run: a run would open or select a real tab.
  it('are scripts Windows PowerShell parses without an error', () => {
    if (process.platform !== 'win32') {
      return;
    }
    const check = [
      '$errors = $null',
      "[void][System.Management.Automation.Language.Parser]::ParseInput($env:TEAMRIG_TEST_SCRIPT, [ref]$null, [ref]$errors)",
      'if ($errors.Count -gt 0) { [Console]::Error.WriteLine(($errors | ForEach-Object { $_.Message }) -join "; "); exit 1 }',
    ].join('\n');
    for (const [name, script] of SCRIPTS) {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(check, 'utf16le').toString('base64')], {
        env: { ...process.env, TEAMRIG_TEST_SCRIPT: script },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    }
  });
});
