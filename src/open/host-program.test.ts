import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from '../core/home.ts';
import { FakePathProbe } from '../testing/fake-processes.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { findProgram, type ProgramSearch } from './host-program.ts';

const NODE = 'C:\\node\\node.exe';
/** The tail of the shim npm writes for a package's bin on Windows. */
const NPM_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join('\r\n');

function windows(env: Env, files: readonly string[], shims: Readonly<Record<string, string>> = {}, name: string = 'claude'): Promise<ProgramSearch> {
  return findProgram({ env, platform: 'win32', probe: new FakePathProbe({ files: [...files, ...Object.keys(shims)] }), files: new MemoryFiles(shims), node: NODE }, name);
}

describe('findProgram on Windows', () => {
  it('finds the native claude.exe on PATH, whatever case the variable has', async () => {
    const found = await windows({ Path: 'C:\\empty;"C:\\Users\\me\\.local\\bin";' }, ['C:\\Users\\me\\.local\\bin\\claude.exe']);
    assert.deepEqual(found, { kind: 'found', program: { command: 'C:\\Users\\me\\.local\\bin\\claude.exe', prefix: [] } });
  });

  it('runs the script behind an npm claude.cmd with Node.js, never through cmd.exe', async () => {
    const script = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
    const found = await windows({ PATH: 'C:\\npm' }, [script], { 'C:\\npm\\claude.cmd': NPM_SHIM });
    assert.deepEqual(found, { kind: 'found', program: { command: NODE, prefix: [script] } });
  });

  it('runs a program behind a shim directly, and takes the PATHEXT order', async () => {
    const shim = '@echo off\r\n"%~dp0\\bin\\claude.exe" %*\r\n';
    const found = await windows({ PATH: 'C:\\tools', PATHEXT: '.BAT;.EXE' }, ['C:\\tools\\bin\\claude.exe', 'C:\\tools\\claude.exe'], { 'C:\\tools\\claude.bat': shim });
    assert.deepEqual(found, { kind: 'found', program: { command: 'C:\\tools\\bin\\claude.exe', prefix: [] } });
  });

  it('skips a shim it cannot read safely and keeps looking', async () => {
    const found = await windows(
      { PATH: 'C:\\a;C:\\b;C:\\c;C:\\d' },
      ['C:\\b\\gone.txt', 'C:\\c\\other.ps1', 'C:\\d\\claude.exe'],
      {
        'C:\\a\\claude.cmd': '@echo off\r\nnode "%~dp0\\cli.js" %*\r\n',
        'C:\\b\\claude.cmd': '"%dp0%\\missing.js" %*',
        'C:\\c\\claude.cmd': '"%dp0%\\other.ps1" %*',
      },
    );
    assert.deepEqual(found, { kind: 'found', program: { command: 'C:\\d\\claude.exe', prefix: [] } });
    const missing = await windows({ PATH: 'C:\\a;C:\\b;C:\\c' }, ['C:\\c\\other.ps1'], {
      'C:\\a\\claude.cmd': 'claude-code %*',
      'C:\\b\\claude.cmd': '"%dp0%\\missing.js" %*',
      'C:\\c\\claude.cmd': '"%dp0%\\other.ps1" %*',
    });
    assert.deepEqual(missing, {
      kind: 'missing',
      skipped: [
        'C:\\a\\claude.cmd is not an npm launcher',
        'C:\\b\\claude.cmd starts C:\\b\\missing.js, which is not there',
        'C:\\c\\claude.cmd starts C:\\c\\other.ps1, which is neither a script nor a program',
      ],
    });
  });

  it('reports nothing found with no PATH, and ignores extensions it does not run', async () => {
    assert.deepEqual(await windows({}, []), { kind: 'missing', skipped: [] });
    assert.deepEqual(await windows({ PATH: 'C:\\x', PATHEXT: '.JS' }, ['C:\\x\\claude.js']), { kind: 'missing', skipped: [] });
  });

  it('looks for the program it is asked for and no other: a native one, or the script behind its npm shim', async () => {
    const both = ['C:\\bin\\claude.exe', 'C:\\bin\\agent-desk.exe'];
    assert.deepEqual(await windows({ PATH: 'C:\\bin' }, both, {}, 'agent-desk'), { kind: 'found', program: { command: 'C:\\bin\\agent-desk.exe', prefix: [] } });
    assert.deepEqual(await windows({ PATH: 'C:\\bin' }, ['C:\\bin\\claude.exe'], {}, 'agent-desk'), { kind: 'missing', skipped: [] });
    const script = 'C:\\npm\\node_modules\\agent-desk\\cli.mjs';
    const shim = '@echo off\r\n"%_prog%"  "%dp0%\\node_modules\\agent-desk\\cli.mjs" %*\r\n';
    assert.deepEqual(await windows({ PATH: 'C:\\npm' }, [script], { 'C:\\npm\\agent-desk.cmd': shim }, 'agent-desk'), { kind: 'found', program: { command: NODE, prefix: [script] } });
  });

  it('finds no program by a name that is no plain file name, so the search stays in the folders PATH names', async () => {
    for (const name of ['..\\tools\\run', 'sub/run', 'C:run', '']) {
      const found = await windows({ PATH: 'C:\\bin' }, ['C:\\tools\\run.exe', 'C:\\bin\\sub\\run.exe', 'C:\\bin\\run.exe', 'C:\\bin\\.exe'], {}, name);
      assert.deepEqual(found, { kind: 'missing', skipped: [`"${name}" is not a program's file name`] }, name);
    }
  });
});

describe('findProgram elsewhere', () => {
  function elsewhere(env: Env, platform: NodeJS.Platform, files: readonly string[], name: string = 'claude'): Promise<ProgramSearch> {
    return findProgram({ env, platform, probe: new FakePathProbe({ files: [...files] }), files: new MemoryFiles(), node: '/n' }, name);
  }

  it('takes the first claude on PATH', async () => {
    const found = await elsewhere({ PATH: '/usr/bin::/opt/claude/bin:/usr/local/bin' }, 'darwin', ['/opt/claude/bin/claude', '/usr/local/bin/claude']);
    assert.deepEqual(found, { kind: 'found', program: { command: '/opt/claude/bin/claude', prefix: [] } });
  });

  it('reads PATH by its exact name, and reports nothing found', async () => {
    assert.deepEqual(await elsewhere({ Path: '/bin' }, 'linux', ['/bin/claude']), { kind: 'missing', skipped: [] });
  });

  it('looks for the program it is asked for and no other, and for none whose name holds a folder', async () => {
    const files = ['/usr/bin/claude', '/usr/local/bin/agent-desk', '/usr/sbin/run'];
    assert.deepEqual(await elsewhere({ PATH: '/usr/bin:/usr/local/bin' }, 'linux', files, 'agent-desk'), { kind: 'found', program: { command: '/usr/local/bin/agent-desk', prefix: [] } });
    assert.deepEqual(await elsewhere({ PATH: '/usr/bin' }, 'linux', files, 'agent-desk'), { kind: 'missing', skipped: [] });
    assert.deepEqual(await elsewhere({ PATH: '/usr/bin' }, 'linux', files, '../sbin/run'), { kind: 'missing', skipped: [`"../sbin/run" is not a program's file name`] });
  });
});
