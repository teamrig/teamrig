import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseShell, type ShellDialect } from '../push-guard/tokenizer.ts';
import { ANY, isPattern, ONE, REST, segmentRegExp, wordPathOf, type WordPathEnv } from './shell-word-path.ts';

const ENV: WordPathEnv = { home: 'C:/u', platform: 'win32', variables: { USERPROFILE: 'C:\\u', Kit: 'C:/u/.teamrig', EMPTY: '' } };

/** The paths of a line's own words (no substitution's), its redirection targets after them, as the guard reads them. */
function pathsOf(line: string, dialect: ShellDialect, env: WordPathEnv = ENV): readonly (string | undefined)[] {
  const own = parseShell(line, dialect).commands.filter((command) => command.nesting === 0);
  return own.flatMap((command) =>
    [...command.words, ...command.redirections.flatMap((redirection) => (redirection.target === undefined ? [] : [redirection.target]))].map((word) =>
      wordPathOf(word, dialect, env),
    ),
  );
}

describe('wordPathOf: bash', () => {
  it('reads quoted text as written and expands a leading ~ only outside quotes', () => {
    assert.deepEqual(pathsOf(`echo ~/.teamrig/cu''rrent ~/.teamrig/"current" "~/x"`, 'bash'), ['echo', 'C:/u/.teamrig/current', 'C:/u/.teamrig/current', '~/x']);
  });

  it('marks unquoted globs and leaves quoted ones plain', () => {
    assert.deepEqual(pathsOf(`ls ~/.tea*/x 'q*' a?[bc]`, 'bash'), ['ls', `C:/u/.tea${ANY}/x`, 'q*', `a${ONE}${ONE}`]);
  });

  it('expands a variable the environment holds, in any case on Windows, and marks one it lacks or holds empty', () => {
    assert.deepEqual(pathsOf('cp $kit/current ${USERPROFILE}/a $NONE/b $EMPTY/c', 'bash'), ['cp', 'C:/u/.teamrig/current', 'C:\\u/a', undefined, undefined]);
    assert.deepEqual(pathsOf('cp ~/$NONE/b', 'bash'), ['cp', `C:/u/${ANY}/b`]);
    const posix: WordPathEnv = { home: '/h', platform: 'linux', variables: { kit: '/h/.teamrig' } };
    assert.deepEqual(pathsOf('cp $Kit/a', 'bash', posix), ['cp', undefined]);
  });

  it('ends a word at a substitution or a brace list, and drops one with nothing known before it', () => {
    assert.deepEqual(pathsOf('cp ~/.teamrig/$(echo current) ~/.teamrig/{a,b} $(pwd)/c', 'bash'), ['cp', `C:/u/.teamrig/${REST}`, `C:/u/.teamrig/${REST}`, undefined]);
  });
});

describe('wordPathOf: PowerShell', () => {
  it('expands $env:X, ${env:X} and $HOME, marks other variables and ends at a subexpression', () => {
    const line = 'Set-Content ${env:USERPROFILE}\\.teamrig\\current $HOME\\.teamrig\\current ~\\.teamrig\\x C:\\$name\\y';
    assert.deepEqual(pathsOf(line, 'powershell'), ['Set-Content', 'C:\\u\\.teamrig\\current', 'C:/u\\.teamrig\\current', 'C:/u\\.teamrig\\x', `C:\\${ANY}\\y`]);
    assert.deepEqual(pathsOf('Get-Item C:\\u\\$(Get-Location)', 'powershell'), ['Get-Item', `C:\\u\\${REST}`]);
  });

  it('marks a wildcard in a quoted word too, as a provider path reads it', () => {
    assert.deepEqual(pathsOf("Set-Content 'curr*' x", 'powershell'), ['Set-Content', `curr${ANY}`, 'x']);
  });
});

describe('wordPathOf: cmd', () => {
  it('expands %X% and ends at a delayed variable', () => {
    assert.deepEqual(pathsOf('type %USERPROFILE%\\.codex\\hooks.json', 'cmd'), ['type', 'C:\\u\\.codex\\hooks.json']);
    assert.deepEqual(pathsOf('type C:\\u\\!x!\\a', 'cmd'), ['type', `C:\\u\\${REST}`]);
  });
});

describe('segmentRegExp and isPattern', () => {
  it('matches one name through its marks, never a separator', () => {
    assert.ok(segmentRegExp(`conf${ANY}.toml`, 'i').test('CONFIG.toml'));
    assert.ok(segmentRegExp(`curr${ONE}nt`, '').test('current'));
    assert.ok(!segmentRegExp(`a${ANY}`, '').test('a/b'));
    assert.ok(isPattern(`a${REST}`));
    assert.ok(!isPattern('C:/u/.teamrig'));
  });
});
