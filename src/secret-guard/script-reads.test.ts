import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runsOf } from '../package-guard/programs.ts';
import type { ShellDialect } from '../push-guard/tokenizer.ts';
import { FakeScripts } from '../testing/fake-scripts.ts';
import { onLocalDrive, scriptReadFindings } from './script-reads.ts';

const KEY_READER = "const { execSync } = require('node:child_process');\nconst t = execSync('gh auth token').toString();\n";
const PLAIN = "console.log('hello');\n";

/** How the guard names each credential read in the scripts `line` starts, read in `dialect` from C:/w. */
function reads(line: string, scripts: FakeScripts, dialect: ShellDialect = 'bash'): string[] {
  const runs = runsOf(line, { cwd: 'C:/w', home: 'C:/u', dialect });
  return scriptReadFindings(runs, scripts, 'C:/u').map((finding) => (finding.kind === 'credential' ? finding.via : finding.kind));
}

describe('scriptReadFindings (T3038)', () => {
  it('reads the script each interpreter starts, and names the store read with the script', () => {
    const cases: readonly (readonly [string, ShellDialect, string])[] = [
      ['node x.js', 'bash', 'x.js'],
      ['node --disable-warning=ExperimentalWarning -r ./hook.js x.js arg', 'bash', 'x.js'],
      ['tsx x.js', 'bash', 'x.js'],
      ['python x.js', 'bash', 'x.js'],
      ['py -X utf8 x.js', 'powershell', 'x.js'],
      ['bash -e x.js', 'bash', 'x.js'],
      ['sh -- x.js', 'bash', 'x.js'],
      ['pwsh -NoProfile -File x.js', 'powershell', 'x.js'],
      ['powershell -ExecutionPolicy Bypass -File x.js', 'powershell', 'x.js'],
      ['pwsh x.js', 'bash', 'x.js'],
      ['pwsh -f x.js', 'bash', 'x.js'],
      ['env -C sub bash ../x.js', 'bash', '../x.js'],
      ['bun run x.js', 'bash', 'x.js'],
      ['deno run --allow-run x.js', 'bash', 'x.js'],
      ['./x.js', 'bash', './x.js'],
      ['teamrig queue --what w -- node x.js', 'bash', 'x.js'],
      ['node C:/w/x.js', 'bash', 'C:/w/x.js'],
      ['node /c/w/x.js', 'bash', '/c/w/x.js'],
      ['cd sub && node ../x.js', 'bash', '../x.js'],
    ];
    for (const [line, dialect, named] of cases) {
      assert.deepEqual(reads(line, new FakeScripts({ 'C:/w/x.js': KEY_READER }), dialect), [`gh auth token in ${named}`], line);
    }
  });

  it('finds each store command, store API and teamrig token name a script holds as text', () => {
    const cases: readonly (readonly [string, string])[] = [
      ["spawnSync('git credential fill', { shell: true })", 'git credential fill'],
      ["exec('git credential-manager get')", 'git credential-<helper> get'],
      ['gh auth status --hostname github.com -t', 'gh auth status --show-token'],
      ['security find-generic-password -s svc -w', 'security find-*-password'],
      ['secret-tool lookup service svc', 'secret-tool lookup'],
      ['cmdkey.exe /list', 'cmdkey /list'],
      ['vaultcmd /listcreds:"Windows Credentials"', 'vaultcmd /listcreds'],
      ['keyring get svc user', 'keyring get'],
      ['$k = Get-Secret -Name svc', 'Get-Secret'],
      ['[DllImport("advapi32")] static extern bool CredReadW();', 'CredRead'],
      ['import keytar from "keytar";', 'keytar'],
      ["keyring.get_password('svc', 'user')", 'keyring.get_password'],
    ];
    for (const [text, label] of cases) {
      assert.deepEqual(reads('node x.js', new FakeScripts({ 'C:/w/x.js': text })), [`${label} in x.js`], text);
    }
  });

  it('passes a script that reads no store, and reads nothing for a line that runs no script file', () => {
    assert.deepEqual(reads('node x.js', new FakeScripts({ 'C:/w/x.js': PLAIN })), []);
    assert.deepEqual(reads('git status', new FakeScripts({ 'C:/w/x.js': KEY_READER })), []);
    // Inline code is the line's own text, which the line's checks read; a module, a test run and stdin start no file here.
    for (const line of ['node -e "1"', 'node --eval=1', 'node --test x.js', 'node - < x.js', 'python -m x.js', 'python -c x', 'bash -c x.js', 'pwsh -Command x.js', 'powershell x.js']) {
      const scripts = new FakeScripts({ 'C:/w/x.js': KEY_READER });
      assert.deepEqual(reads(line, scripts, line.startsWith('p') ? 'powershell' : 'bash'), [], line);
    }
  });

  it('reads no word only known when the line runs, and no relative path from a folder it cannot know', () => {
    const scripts = new FakeScripts({ 'C:/w/x.js': KEY_READER });
    assert.deepEqual(reads('node "$S"', scripts), []);
    assert.deepEqual(reads('cd "$D" && node x.js', scripts), []);
    assert.deepEqual(scripts.reads, []);
  });

  it('reads a program word with no extension only as a script with a #! line, and never a binary by its extension', () => {
    assert.deepEqual(reads('./run', new FakeScripts({ 'C:/w/run': `#!/usr/bin/env node\n${KEY_READER}` })), ['gh auth token in ./run']);
    assert.deepEqual(reads('./run', new FakeScripts({ 'C:/w/run': KEY_READER })), []);
    const scripts = new FakeScripts({ 'C:/w/tool.exe': KEY_READER });
    assert.deepEqual(reads('./tool.exe', scripts), []);
    assert.deepEqual(scripts.reads, []);
  });

  it('holds no finding for a script it cannot read', () => {
    assert.deepEqual(reads('node missing.js', new FakeScripts()), []);
  });

  it('opens no script off this host\'s drives, as a share or device path, before the line is let run', () => {
    const cases: readonly (readonly [string, ShellDialect])[] = [
      ['bash //host/share/x.sh', 'bash'],
      ["node '\\\\host\\share\\x.js'", 'bash'],
      ['cd //host/share && bash x.sh', 'bash'],
      ['pwsh -File \\\\host\\share\\x.ps1', 'powershell'],
      ['& \\\\host\\share\\x.ps1', 'powershell'],
      ['python \\\\?\\UNC\\host\\share\\x.py', 'powershell'],
      ['node \\\\.\\pipe\\x.js', 'powershell'],
    ];
    for (const [line, dialect] of cases) {
      const scripts = new FakeScripts({ '//host/share/x.sh': KEY_READER });
      assert.deepEqual(reads(line, scripts, dialect), [], line);
      assert.deepEqual(scripts.reads, [], line);
    }
  });
});

describe('onLocalDrive (T3038)', () => {
  it('takes a drive path on any host, and a root path only off Windows', () => {
    assert.equal(onLocalDrive('C:\\w\\x.js', 'win32'), true);
    assert.equal(onLocalDrive('d:/w/x.js', 'win32'), true);
    assert.equal(onLocalDrive('/srv/w/x.sh', 'linux'), true);
    assert.equal(onLocalDrive('/w/x.js', 'win32'), false);
  });

  it('refuses a share, a device and a relative path on every host', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      for (const path of ['//host/share/x.sh', '\\\\host\\share\\x.js', '\\\\?\\UNC\\host\\share\\x.py', '\\\\.\\pipe\\x', '\\w\\x.js', 'x.js', 'C:x.js']) {
        assert.equal(onLocalDrive(path, platform), false, `${platform} ${path}`);
      }
    }
  });
});
