import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POSSIBLE_READINGS, resolvePossibleVariables } from './possible-values.ts';
import { parseShell, type ShellCommand } from './tokenizer.ts';

/** The commands of a bash line once per way its variables may be bound, or undefined when it is not read. */
function resolve(line: string, home?: string): readonly ShellCommand[] | undefined {
  return resolvePossibleVariables(parseShell(line, 'bash'), home);
}

/** The words of each command running `program`, joined, a dynamic word marked with a leading `~`. */
function runs(line: string, program: string, home?: string): readonly string[] {
  const commands = resolve(line, home);
  assert.ok(commands !== undefined, line);
  return commands.filter((command) => command.words[0]?.text === program).map((command) => command.words.map((word) => (word.dynamic ? `~${word.text}` : word.text)).join(' '));
}

describe('resolvePossibleVariables', () => {
  it('gives a variable bound once that value, in no subshell of its own', () => {
    const commands = resolve('X=/a; rm $X/b');
    assert.ok(commands !== undefined);
    const rm = commands.find((command) => command.words[0]?.text === 'rm');
    assert.deepEqual(rm?.words.map((word) => word.text), ['rm', '/a/b']);
    assert.deepEqual(rm?.subshells, []);
  });

  it('reads each value a variable is given anywhere, each way in a subshell of its own', () => {
    const commands = resolve('X=/a; X=/b; rm $X');
    assert.ok(commands !== undefined);
    const rms = commands.filter((command) => command.words[0]?.text === 'rm');
    assert.deepEqual(rms.map((command) => command.words[1]?.text), ['/a', '/b']);
    const [first, second] = rms.map((command) => command.subshells[0]);
    assert.ok(first !== undefined && second !== undefined && first < 0 && second < 0 && first !== second);
  });

  it('reads the NAME=value operands of declare, typeset, local and readonly, past their options', () => {
    for (const builtin of ['declare -x', 'declare -r', 'typeset', 'local', 'readonly', 'export']) {
      assert.deepEqual(runs(`${builtin} X=/a; rm $X`, 'rm'), ['rm /a'], builtin);
    }
  });

  it('reads a binding inside a group, a function body or an if body', () => {
    for (const line of ['{ X=/a; rm $X; }', 'f() { X=/a; rm $X; }; f', 'function f { X=/a; rm $X; }; f', 'if true; then X=/a; fi; rm $X']) {
      assert.deepEqual(runs(line, 'rm'), ['rm /a'], line);
    }
  });

  it('adds the home the line starts with to the values HOME may hold', () => {
    assert.deepEqual(runs('rm $HOME/x', 'rm', 'C:\\u'), ['rm C:/u/x']);
  });

  it('keeps a variable it meets again in its own value only known when it runs', () => {
    assert.deepEqual(runs('X=$X/a; rm $X', 'rm'), ['rm ~${X}/a']);
  });

  it('leaves every variable as written on a line that sets IFS or an array element', () => {
    assert.deepEqual(runs('IFS=/; X=/a; rm $X', 'rm'), ['rm ~$X']);
    assert.deepEqual(runs('A[0]=/b; X=/a; rm $X', 'rm'), ['rm ~$X']);
  });

  it('reads no line that reads a name a declaration option may change', () => {
    for (const line of ['X=/A; declare -l X; rm $X', 'declare -u X=/a; rm $X', 'declare -n X=Y; Y=/a; rm $X', 'local -i X=1; rm $X', 'declare $o X=/a; rm $X']) {
      assert.equal(resolve(line), undefined, line);
    }
    assert.deepEqual(runs('declare -l Y=/A; X=/a; rm $X', 'rm'), ['rm /a']);
  });

  it(`reads no line needing more than ${MAX_POSSIBLE_READINGS} ways`, () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const bindings = names.map((name) => `${name}=/a; ${name}=/b`).join('; ');
    assert.equal(resolve(`${bindings}; rm ${names.map((name) => `$${name}`).join('')}`), undefined);
    assert.ok(resolve(`${bindings}; rm $A$B$C$D$E$F`) !== undefined);
  });
});
