import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { ProgramRequest, ProgramResult, ProgramRunner } from '../core/program-runner.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import {
  SHELL_BLOCK_END,
  SHELL_BLOCK_START,
  shellBlock,
  systemUserPath,
  WINDOWS_ENVIRONMENT_KEY,
  WINDOWS_READ_PATH_SCRIPT,
  windowsAddPathScript,
  windowsPathHolds,
  withShellBlock,
} from './user-path.ts';

const HOME = join('/', 'srv', 'pat');
const BIN = join(HOME, '.teamrig', 'bin');
const WINDOWS_BIN = 'D:\\kits\\Zoë\\.teamrig\\bin';

function exited(code: number, stdout = '', stderr = ''): ProgramResult {
  return { end: { kind: 'exited', code }, stdout, stderr };
}

/** A runner that records each request and answers with the next of `results`, else an empty exit 0. */
function recordingRunner(results: ProgramResult[] = []): { readonly run: ProgramRunner; readonly ran: ProgramRequest[] } {
  const ran: ProgramRequest[] = [];
  return {
    ran,
    run: async (request) => {
      ran.push(request);
      return results.shift() ?? exited(0);
    },
  };
}

/** The script a PowerShell request carries. */
function scriptOf(request: ProgramRequest | undefined): string {
  assert.ok(request !== undefined);
  assert.equal(request.program, 'powershell.exe');
  return Buffer.from(request.args.at(-1) ?? '', 'base64').toString('utf16le');
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('windowsPathHolds', () => {
  it('finds the folder in any case, a trailing backslash or blanks around an entry aside', () => {
    for (const path of [`C:\\Windows;${WINDOWS_BIN}`, `${WINDOWS_BIN.toUpperCase()}\\;C:\\Windows`, `C:\\Windows; ${WINDOWS_BIN} ;`]) {
      assert.equal(windowsPathHolds(path, WINDOWS_BIN), true, path);
    }
    assert.equal(windowsPathHolds(`C:\\Windows;${WINDOWS_BIN}`, `${WINDOWS_BIN}\\`), true);
  });

  it('holds no folder that is only a part of an entry, nor one in an empty PATH', () => {
    for (const path of ['', 'C:\\Windows', `${WINDOWS_BIN}\\old`, `C:\\other${WINDOWS_BIN.slice(2)}`]) {
      assert.equal(windowsPathHolds(path, WINDOWS_BIN), false, path);
    }
  });
});

describe('the shell block', () => {
  it('puts the folder last on the PATH once, so it shadows no program of the user, quoting what sh would expand', () => {
    const block = shellBlock('/srv/pat/$HOME`x`"q"\\b');
    const lines = block.split('\n');
    assert.deepEqual([lines[0], lines[2], lines.length], [SHELL_BLOCK_START, SHELL_BLOCK_END, 3]);
    const quoted = '"/srv/pat/\\$HOME\\`x\\`\\"q\\"\\\\b"';
    assert.equal(lines[1], `case ":$PATH:" in *:${quoted}:*) ;; *) PATH="$PATH":${quoted}; export PATH ;; esac`);
  });

  it('is added at the end of a file, a blank line before it, and replaced where it stands', () => {
    const block = shellBlock(BIN);
    assert.equal(withShellBlock('', block), `${block}\n`);
    assert.equal(withShellBlock('alias ll="ls -l"', block), `alias ll="ls -l"\n\n${block}\n`);
    assert.equal(withShellBlock('alias ll="ls -l"\n', block), `alias ll="ls -l"\n\n${block}\n`);
    const old = `export A=1\n${shellBlock('/old/bin')}\nexport B=2\n`;
    assert.equal(withShellBlock(old, block), `export A=1\n${block}\nexport B=2\n`);
    assert.equal(withShellBlock(withShellBlock(old, block), block), withShellBlock(old, block));
  });

  it('is added again at the end when a file holds its start line with no end line', () => {
    const torn = `${SHELL_BLOCK_START}\nexport A=1\n`;
    assert.equal(withShellBlock(torn, shellBlock(BIN)), `${torn}\n${shellBlock(BIN)}\n`);
  });

  it("rewrites only its own block when a torn start line stands before it, keeping the user's lines between", () => {
    const torn = `${SHELL_BLOCK_START}\nexport A=1\n\n${shellBlock(BIN)}\n`;
    const block = shellBlock('/srv/new/bin');
    assert.equal(withShellBlock(torn, block), `${SHELL_BLOCK_START}\nexport A=1\n\n${block}\n`);
  });
});

describe('systemUserPath off Windows', () => {
  const profile = join(HOME, '.profile');
  const bashrc = join(HOME, '.bashrc');
  const bashProfile = join(HOME, '.bash_profile');
  const zshrc = join(HOME, '.zshrc');

  it('writes the block to ~/.profile always, and to the bash and zsh start files only where they exist, on Linux', async () => {
    const files = new MemoryFiles({ [bashrc]: 'alias ll="ls -l"\n' });
    const userPath = systemUserPath('linux', recordingRunner().run, files, HOME);
    assert.equal(userPath.where, profile);
    assert.equal(await userPath.holds(BIN), false);
    await userPath.add(BIN);
    const block = shellBlock(BIN);
    assert.deepEqual(
      [files.get(profile), files.get(bashrc), files.get(bashProfile), files.get(zshrc)],
      [`${block}\n`, `alias ll="ls -l"\n\n${block}\n`, undefined, undefined],
    );
    assert.equal(await userPath.holds(BIN), true);
  });

  it('writes ~/.zshrc on macOS, whose default shell is zsh, even where it is missing', async () => {
    const files = new MemoryFiles();
    await systemUserPath('darwin', recordingRunner().run, files, HOME).add(BIN);
    assert.deepEqual([files.get(profile), files.get(zshrc)], [`${shellBlock(BIN)}\n`, `${shellBlock(BIN)}\n`]);
  });

  it('rewrites only a file that lacks the block, so adding again changes nothing', async () => {
    const block = shellBlock(BIN);
    const files = new MemoryFiles({ [profile]: `${block}\n`, [bashProfile]: `${shellBlock('/old/bin')}\n` });
    const userPath = systemUserPath('linux', recordingRunner().run, files, HOME);
    assert.equal(await userPath.holds(BIN), false);
    await userPath.add(BIN);
    assert.deepEqual([files.get(profile), files.get(bashProfile)], [`${block}\n`, `${block}\n`]);
    await userPath.add(BIN);
    assert.deepEqual([files.get(profile), files.get(bashProfile)], [`${block}\n`, `${block}\n`]);
  });

  it('runs no program', async () => {
    const { run, ran } = recordingRunner();
    const userPath = systemUserPath('linux', run, new MemoryFiles(), HOME);
    await userPath.holds(BIN);
    await userPath.add(BIN);
    assert.equal(ran.length, 0);
  });
});

describe('systemUserPath on Windows', () => {
  it("is the Environment key's Path, read unexpanded from UTF-8 base64", async () => {
    const { run, ran } = recordingRunner([exited(0, `${base64(`%USERPROFILE%\\bin;${WINDOWS_BIN}`)}\r\n`), exited(0, `${base64('%USERPROFILE%\\bin')}\r\n`), exited(0, '\r\n')]);
    const userPath = systemUserPath('win32', run, new MemoryFiles(), 'D:\\kits\\Zoë');
    assert.equal(userPath.where, `${WINDOWS_ENVIRONMENT_KEY} Path`);
    assert.deepEqual([await userPath.holds(WINDOWS_BIN), await userPath.holds(WINDOWS_BIN), await userPath.holds(WINDOWS_BIN)], [true, false, false]);
    assert.equal(scriptOf(ran[0]), WINDOWS_READ_PATH_SCRIPT);
    assert.match(WINDOWS_READ_PATH_SCRIPT, /DoNotExpandEnvironmentNames/);
  });

  it('adds the folder through the registry, keeping the value kind, and tells running programs, never through setx', async () => {
    const { run, ran } = recordingRunner();
    await systemUserPath('win32', run, new MemoryFiles(), 'D:\\kits\\Zoë').add(WINDOWS_BIN);
    const script = scriptOf(ran[0]);
    assert.equal(script, windowsAddPathScript(WINDOWS_BIN));
    assert.ok(script.includes(`FromBase64String('${base64(WINDOWS_BIN)}')`));
    assert.match(script, /\$key\.SetValue\('Path', \$joined, \$kind\)/);
    assert.match(script, /GetValueKind\('Path'\)/);
    assert.match(script, /SendMessageTimeout\(\[IntPtr\]0xffff, 0x1A/);
    assert.doesNotMatch(script, /setx/i);
  });

  it('throws with what PowerShell said when a read or an add fails', async () => {
    const { run } = recordingRunner([exited(1, '', 'Access denied\r\n'), exited(1, '', 'Requested registry access is not allowed.\r\n')]);
    const userPath = systemUserPath('win32', run, new MemoryFiles(), 'D:\\kits\\Zoë');
    await assert.rejects(userPath.holds(WINDOWS_BIN), /PowerShell ended with exit 1: Access denied/);
    await assert.rejects(userPath.add(WINDOWS_BIN), /Requested registry access is not allowed/);
  });
});
