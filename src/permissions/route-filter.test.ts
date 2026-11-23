import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRouteFilter } from './route-filter.ts';

const words = (line: string): readonly string[] => line.split(' ');

describe('isRouteFilter', () => {
  it('F4: passes each filter bare and with each allowed flag', () => {
    for (const line of [
      'head',
      'head -n 5',
      'head -5',
      'head -c 100',
      'tail',
      'tail -n 20',
      'tail -20',
      'tail -c 100',
      'grep open',
      'grep -i open',
      'grep -v open',
      'grep -n open',
      'grep -c open',
      'grep -E open.+',
      'grep -F open',
      'grep -w open',
      'grep -x open',
      'grep -o open',
      'grep -m 3 open',
      'grep -A 2 open',
      'grep -B 2 open',
      'grep -C 2 open',
      'grep -i -n -A 1 open',
      'wc',
      'wc -l',
      'wc -w',
      'wc -c',
      'wc -m',
    ]) {
      assert.equal(isRouteFilter(words(line)), true, line);
    }
    assert.equal(isRouteFilter(['grep', '-i', 'open task']), true);
  });

  it('F1: refuses a flag that follows, recurses, reads a named file or sets a pattern file', () => {
    for (const line of [
      'tail -f',
      'tail -F',
      'tail --follow',
      'tail --pid 1',
      'head --lines=5',
      'grep -r open',
      'grep -R open',
      'grep --recursive open',
      'grep -f patterns.txt',
      'grep --file patterns.txt',
      'grep -d recurse open',
      'grep --include *.ts open',
      'grep --exclude-from x open',
      'grep --exclude-dir x open',
      'grep -e open',
      'wc --files0-from x',
      'wc -L',
    ]) {
      assert.equal(isRouteFilter(words(line)), false, line);
    }
  });

  it('F1: refuses a file operand, a missing or wrong count, and a second or missing pattern', () => {
    for (const line of [
      'head secrets.yaml',
      'head -n 5 secrets.yaml',
      'tail -n',
      'tail -n x',
      'tail -n -5',
      'wc -l secrets.yaml',
      'grep',
      'grep open secrets.yaml',
      'grep -m open',
      'grep -A',
    ]) {
      assert.equal(isRouteFilter(words(line)), false, line);
    }
    assert.equal(isRouteFilter(['grep', '']), false);
    assert.equal(isRouteFilter([]), false);
  });

  it('F4: refuses every program that is not one of the filters', () => {
    for (const program of ['tee', 'xargs', 'sh', 'bash', 'node', 'pwsh', 'cat', 'sort', 'Out-File', 'Set-Content', 'Invoke-Expression', 'iex', 'ForEach-Object', 'constructor', 'toString']) {
      assert.equal(isRouteFilter([program]), false, program);
      assert.equal(isRouteFilter([program, 'x']), false, program);
    }
  });
});
