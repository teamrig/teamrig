import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRIPT_OPEN_FLAGS, diskScriptTexts, type OpenFileStats, type ScriptFileCalls } from './script-files.ts';

/** File calls over one file the spec describes, recording each call in order. */
class RecordedCalls implements ScriptFileCalls {
  readonly calls: string[] = [];
  private readonly stats: OpenFileStats;
  private readonly readFails: boolean;

  constructor(stats: OpenFileStats, readFails = false) {
    this.stats = stats;
    this.readFails = readFails;
  }

  open(path: string, flags: number): number {
    this.calls.push(`open ${path} ${flags === SCRIPT_OPEN_FLAGS ? 'guard-flags' : flags}`);
    return 7;
  }

  stat(fd: number): OpenFileStats {
    this.calls.push(`stat ${fd}`);
    return this.stats;
  }

  read(fd: number): string {
    this.calls.push(`read ${fd}`);
    if (this.readFails) {
      throw new Error('EIO');
    }
    return 'abc';
  }

  close(fd: number): void {
    this.calls.push(`close ${fd}`);
  }
}

const FILE: OpenFileStats = { isFile: () => true, size: 3 };
const PIPE: OpenFileStats = { isFile: () => false, size: 0 };

describe('diskScriptTexts', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'teamrig-script-files-'));
    writeFileSync(join(dir, 'small.js'), 'abc');
    writeFileSync(join(dir, 'big.js'), 'abcdef');
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a regular file at or under the cap, and nothing over it, missing, or a folder', () => {
    const scripts = diskScriptTexts(5);
    assert.equal(scripts.text(join(dir, 'small.js')), 'abc');
    assert.equal(scripts.text(join(dir, 'big.js')), undefined);
    assert.equal(scripts.text(join(dir, 'missing.js')), undefined);
    assert.equal(scripts.text(dir), undefined);
  });

  it('opens the path once and checks what it opened, so a file swapped for a pipe is never read (T3038)', () => {
    const file = new RecordedCalls(FILE);
    assert.equal(diskScriptTexts(5, file).text('C:/w/x.sh'), 'abc');
    assert.deepEqual(file.calls, ['open C:/w/x.sh guard-flags', 'stat 7', 'read 7', 'close 7']);
    const pipe = new RecordedCalls(PIPE);
    assert.equal(diskScriptTexts(5, pipe).text('C:/w/x.sh'), undefined);
    assert.deepEqual(pipe.calls, ['open C:/w/x.sh guard-flags', 'stat 7', 'close 7']);
  });

  it('closes what it opened when the read fails', () => {
    const failing = new RecordedCalls(FILE, true);
    assert.equal(diskScriptTexts(5, failing).text('C:/w/x.sh'), undefined);
    assert.deepEqual(failing.calls, ['open C:/w/x.sh guard-flags', 'stat 7', 'read 7', 'close 7']);
  });
});
