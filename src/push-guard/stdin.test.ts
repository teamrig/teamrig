import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './launchers.ts';
import { pipesOn, printedText, redirectsInput, stdinUse, type StdinUse } from './stdin.ts';
import { parseShell, type ShellDialect } from './tokenizer.ts';

/** What the first command of a bash line does with what it reads on stdin. */
function use(line: string): StdinUse {
  const command = parseShell(line, 'bash').commands[0];
  assert.ok(command !== undefined, line);
  return stdinUse(command, launch(command.words, 'bash', command.stdin));
}

function expectUse(lines: readonly string[], expected: StdinUse): void {
  for (const line of lines) {
    assert.equal(use(line), expected, line);
  }
}

describe('stdinUse', () => {
  it('stores what a plain cat writes to a named file', () => {
    expectUse(['cat > notes.md', 'cat >> notes.md', 'cat - >| n', 'cat 1> n', 'cat >&2 > n', 'env cat > n 2> err'], 'stored');
  });

  it('passes what a plain cat writes down a pipe', () => {
    expectUse(['cat | bash', 'cat |& bash', 'cat - 2> err | x'], 'passed');
  });

  it('reads it otherwise: another program, an argument, the terminal, a device or a file only known when it runs', () => {
    expectUse(['cat', 'cat; x', 'cat x | bash', 'tee n', 'xargs cat > n', '$C > n'], 'read');
    expectUse(['cat > /dev/stdout', 'cat > /proc/self/fd/1', 'cat > "$F"', 'cat > n >&2', 'cat > n 1>&2 | x'], 'read');
  });
});

describe('printedText', () => {
  /** The text the first command of a line prints from the line, or undefined. */
  function printed(line: string, dialect: ShellDialect = 'bash'): string | undefined {
    const command = parseShell(line, dialect).commands[0];
    assert.ok(command !== undefined, line);
    return printedText(command, launch(command.words, dialect, command.stdin), dialect)?.text;
  }

  it('reads what echo, printf, Write-Output and a lone PowerShell string print', () => {
    assert.equal(printed("echo -n 'rm -rf x' y"), 'rm -rf x y');
    assert.equal(printed("printf 'a\\nb'"), 'a\nb');
    assert.equal(printed('echo "rm $X"'), 'rm $X');
    assert.equal(printed("Write-Output 'a' 'b'", 'powershell'), 'a\nb');
    assert.equal(printed("'Remove-Item x' | iex", 'powershell'), 'Remove-Item x');
    assert.equal(printed('echo rmdir x', 'cmd'), 'rmdir x');
  });

  it('reads nothing from another program, a redirected stdout or a program only known when it runs', () => {
    for (const line of ['cat x', 'echo a > n', 'echo a >&2', '$P a', 'xargs echo']) {
      assert.equal(printed(line), undefined, line);
    }
  });

  it('tells a pipe from any other terminator', () => {
    const pipes = (line: string): boolean => {
      const command = parseShell(line, 'bash').commands[0];
      assert.ok(command !== undefined, line);
      return pipesOn(command);
    };
    assert.deepEqual(['echo a | bash', 'echo a |& bash', 'echo a; bash', 'echo a && bash', 'echo a'].map(pipes), [true, true, false, false, false]);
  });
});

describe('redirectsInput', () => {
  it('tells a stdin redirection from a pipe or an output redirection', () => {
    const redirects = (line: string): boolean => {
      const command = parseShell(line, 'bash').commands[0];
      assert.ok(command !== undefined, line);
      return redirectsInput(command);
    };
    assert.deepEqual(['bash < s.sh', 'bash 0< s.sh', 'bash > out', 'bash 2> err', 'bash'].map(redirects), [true, true, false, false, false]);
  });
});
