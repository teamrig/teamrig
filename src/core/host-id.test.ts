import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryFiles } from '../testing/memory-files.ts';
import { hostIdFile, readHostId } from './host-id.ts';

const HOME = '/kit';
const MINE = '0123456789abcdef0123456789abcdef';
const THEIRS = 'fedcba9876543210fedcba9876543210';

/** Files where another run makes the host id first, between this run's read and its create. */
class RacedFiles extends MemoryFiles {
  override async createExclusive(path: string, text: string): Promise<boolean> {
    await super.createExclusive(path, `${THEIRS}\n`);
    return super.createExclusive(path, text);
  }
}

describe('readHostId', () => {
  it('makes the id once and keeps it in the kit home', async () => {
    const files = new MemoryFiles();
    assert.equal(await readHostId(files, HOME, () => MINE), MINE);
    assert.equal(files.get(hostIdFile(HOME)), `${MINE}\n`);
  });

  it('reads the kept id and never makes another', async () => {
    const files = new MemoryFiles();
    await files.write(hostIdFile(HOME), `${THEIRS}\n`);
    assert.equal(await readHostId(files, HOME, () => assert.fail('no new id is made')), THEIRS);
  });

  it("takes the winner's id when another run made it first", async () => {
    const files = new RacedFiles();
    assert.equal(await readHostId(files, HOME, () => MINE), THEIRS);
  });

  it('refuses a file that holds no host id and leaves it as it was', async () => {
    const files = new MemoryFiles();
    await files.write(hostIdFile(HOME), 'my-laptop\n');
    await assert.rejects(readHostId(files, HOME, () => MINE), /does not hold a host id/);
    assert.equal(files.get(hostIdFile(HOME)), 'my-laptop\n');
  });

  it('refuses a made id that is not 32 lowercase hex, writing nothing', async () => {
    const files = new MemoryFiles();
    await assert.rejects(readHostId(files, HOME, () => MINE.toUpperCase()), /32 lowercase hex/);
    assert.equal(files.get(hostIdFile(HOME)), undefined);
  });
});
