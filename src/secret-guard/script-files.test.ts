import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskScriptTexts } from './script-files.ts';

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
});
