import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REMOVE_RETRY_DELAYS_MS, removeHeldFolder, TempRepo } from './temp-repo.ts';

function fsError(code: string): Error {
  return Object.assign(new Error(`${code}: resource busy or locked`), { code });
}

/** A removal that fails with the given codes in order, then succeeds; it records each call and wait. */
class HeldRemoval {
  readonly removed: string[] = [];
  readonly slept: number[] = [];
  private readonly failures: readonly string[];

  constructor(failures: readonly string[]) {
    this.failures = failures;
  }

  readonly remove = (path: string): void => {
    const code = this.failures[this.removed.length];
    this.removed.push(path);
    if (code !== undefined) {
      throw fsError(code);
    }
  };

  readonly sleep = (ms: number): void => {
    this.slept.push(ms);
  };
}

describe('removeHeldFolder (T5814)', () => {
  it('repeats through EBUSY, EPERM, EACCES and ENOTEMPTY with growing waits', () => {
    const held = new HeldRemoval(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
    removeHeldFolder('repo', held.remove, held.sleep);
    assert.deepEqual([held.removed.length, held.slept], [5, REMOVE_RETRY_DELAYS_MS.slice(0, 4)]);
  });

  it('throws any other error at once', () => {
    const held = new HeldRemoval(['ENOENT']);
    assert.throws(() => removeHeldFolder('repo', held.remove, held.sleep), { code: 'ENOENT' });
    assert.deepEqual([held.removed.length, held.slept], [1, []]);
  });

  it('throws the held error after the last delay', () => {
    const held = new HeldRemoval(['EBUSY', 'EBUSY', 'EBUSY']);
    assert.throws(() => removeHeldFolder('repo', held.remove, held.sleep, [1, 2]), { code: 'EBUSY' });
    assert.deepEqual([held.removed.length, held.slept], [3, [1, 2]]);
  });
});

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

describe('TempRepo.remove (T5814)', () => {
  it('removes its folder while a child process ending there still holds it as its cwd', async () => {
    const repo = new TempRepo('held-cwd').init();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 800)'], { cwd: repo.dir, stdio: 'ignore', windowsHide: true });
    try {
      await once(child, 'spawn');
      repo.remove();
      assert.equal(existsSync(repo.dir), false);
    } finally {
      if (child.exitCode === null) await once(child, 'exit');
    }
  });
});
