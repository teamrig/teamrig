import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TempRepo } from './temp-repo.ts';

describe('TempRepo.copyFrom (T5032)', () => {
  it("starts a repo from the template's commits and outside files, each copy changing apart from the template", () => {
    const template = new TempRepo('copy-template').init();
    const copy = new TempRepo('copy-of');
    try {
      template.write('app.txt', 'one\n');
      template.git('add', '--', 'app.txt');
      template.git('commit', '-qm', 'one');
      writeFileSync(join(template.outside, 'event.json'), '{}');
      copy.copyFrom(template);
      assert.equal(copy.git('rev-parse', 'HEAD'), template.git('rev-parse', 'HEAD'));
      assert.equal(copy.git('status', '--porcelain'), '');
      assert.equal(readFileSync(join(copy.outside, 'event.json'), 'utf8'), '{}');
      copy.write('app.txt', 'two\n');
      copy.git('commit', '-qam', 'two');
      assert.notEqual(copy.git('rev-parse', 'HEAD'), template.git('rev-parse', 'HEAD'));
      assert.equal(template.git('status', '--porcelain'), '');
      assert.equal(readFileSync(join(template.dir, 'app.txt'), 'utf8'), 'one\n');
    } finally {
      copy.remove();
      template.remove();
    }
  });

  it('runs no git in the background after a commit, which would change the template while it is copied (T5182)', () => {
    const repo = new TempRepo('no-maintenance').init();
    try {
      const trace = join(repo.outside, 'trace.json');
      const result = spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'one'], { cwd: repo.dir, env: { ...repo.env, GIT_TRACE2_EVENT: trace }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const children = readFileSync(trace, 'utf8')
        .split('\n')
        .filter((line) => line.includes('"event":"child_start"'));
      assert.deepEqual(children.filter((line) => line.includes('"maintenance"')), []);
    } finally {
      repo.remove();
    }
  });
});
