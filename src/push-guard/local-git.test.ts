import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CommitLog, CommitRange } from './commit-size.ts';
import type { ConfigValue } from './invocations.ts';
import { commitLogOnLocalDrives, onLocalDrivesOnly } from './local-git.ts';
import type { RepoState } from './push.ts';

/** Repository state that answers every read and records the folder of each. */
class RecordingRepo implements RepoState {
  readonly reads: string[] = [];

  branch(dir: string): string | undefined {
    this.reads.push(`branch ${dir}`);
    return 'feat';
  }

  head(dir: string): string | undefined {
    this.reads.push(`head ${dir}`);
    return 'abc1234';
  }

  pushTarget(dir: string, branch?: string): string | undefined {
    this.reads.push(`pushTarget ${dir} ${branch ?? ''}`);
    return 'origin/feat';
  }

  config(dir: string, key: string): ConfigValue {
    this.reads.push(`config ${dir} ${key}`);
    return { kind: 'set', value: 'x' };
  }
}

/** A commit log that answers every range and records the folder of each. */
class RecordingLog implements CommitLog {
  readonly reads: string[] = [];

  between(dir: string, base: string, tip: string): CommitRange {
    this.reads.push(`between ${dir} ${base}..${tip}`);
    return { kind: 'listed', commits: [] };
  }
}

const SHARES = ['//host/share/w', '\\\\host\\share\\w', '\\\\?\\UNC\\host\\share\\w', '\\\\.\\pipe\\w'];

describe('onLocalDrivesOnly (T3339)', () => {
  it('reads git in a folder on this host\'s drives', () => {
    const repo = new RecordingRepo();
    const local = onLocalDrivesOnly(repo);
    assert.equal(local.branch('C:/w'), 'feat');
    assert.equal(local.head('C:/w'), 'abc1234');
    assert.equal(local.pushTarget('C:/w', 'feat'), 'origin/feat');
    assert.deepEqual(local.config('C:/w', 'push.default'), { kind: 'set', value: 'x' });
    assert.deepEqual(repo.reads, ['branch C:/w', 'head C:/w', 'pushTarget C:/w feat', 'config C:/w push.default']);
  });

  it('runs no git in a share or device folder, and reads each value there as unknown', () => {
    for (const dir of SHARES) {
      const repo = new RecordingRepo();
      const local = onLocalDrivesOnly(repo);
      assert.equal(local.branch(dir), undefined, dir);
      assert.equal(local.head(dir), undefined, dir);
      assert.equal(local.pushTarget(dir, 'feat'), undefined, dir);
      assert.deepEqual(local.config(dir, 'push.default'), { kind: 'unreadable' }, dir);
      assert.deepEqual(repo.reads, [], dir);
    }
  });
});

describe('commitLogOnLocalDrives (T3339)', () => {
  it('reads the log on this host\'s drives, and runs no git in a share or device folder', () => {
    const log = new RecordingLog();
    const local = commitLogOnLocalDrives(log);
    assert.deepEqual(local.between('C:/w', 'main', 'HEAD'), { kind: 'listed', commits: [] });
    for (const dir of SHARES) {
      assert.deepEqual(local.between(dir, 'main', 'HEAD'), { kind: 'refused' }, dir);
    }
    assert.deepEqual(log.reads, ['between C:/w main..HEAD']);
  });
});
