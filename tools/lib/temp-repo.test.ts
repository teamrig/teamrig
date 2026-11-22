import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});
