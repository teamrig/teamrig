import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { teamPaths } from '../core/home.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { connectorState } from './connector-state.ts';
import { GITHUB_CONNECTOR_ID, openGithubState } from './github-state.ts';

const paths = teamPaths(join('kit', 'home'), 'crew', join('kit', 'claude'));
const github = connectorState(paths, GITHUB_CONNECTOR_ID);
const earlier = (name: string): string => join(paths.state, name);

describe('openGithubState', () => {
  it("gives GitHub's paths in its own connector folder (T5114)", async () => {
    const state = await openGithubState(new MemoryFiles(), paths);
    assert.equal(state.dir, join(paths.state, 'connectors', 'github'));
    assert.deepEqual(state, github);
  });

  it('moves every file an older teamrig kept in the state folder into GitHub\'s own, text unchanged', async () => {
    const files = new MemoryFiles({
      [earlier('github-sync.json')]: 'sync',
      [earlier('github-push-hour.json')]: 'hour',
      [earlier('github-clocks.json')]: 'clocks',
      [earlier('github-watch.json')]: 'watch',
      [earlier('github-claims.json')]: 'claims',
      [earlier('github-follows.json')]: 'follows',
      [join(earlier('github-ci'), 'o-n-1.md')]: 'ci',
    });
    await openGithubState(files, paths);
    assert.deepEqual(
      [github.sync, github.pushHour, github.clocks, github.watch, github.claims, github.follows, join(github.ci, 'o-n-1.md')].map((path) => files.get(path)),
      ['sync', 'hour', 'clocks', 'watch', 'claims', 'follows', 'ci'],
    );
    assert.deepEqual(
      files.paths().filter((path) => !path.includes('/connectors/')),
      [],
    );
  });

  it('leaves the locks where they are, so an older teamrig that holds one keeps it', async () => {
    const files = new MemoryFiles({ [earlier('github-sync.lock')]: '1', [earlier('github-watch.lock')]: '2' });
    await openGithubState(files, paths);
    assert.equal(files.get(earlier('github-sync.lock')), '1');
    assert.equal(files.get(earlier('github-watch.lock')), '2');
    assert.equal(files.get(github.syncLock), undefined);
  });

  it('keeps the newer file when both are there, and leaves the older one untouched', async () => {
    const files = new MemoryFiles({ [earlier('github-claims.json')]: 'old', [github.claims]: 'new', [earlier('github-clocks.json')]: 'clocks' });
    await openGithubState(files, paths);
    assert.equal(files.get(github.claims), 'new');
    assert.equal(files.get(earlier('github-claims.json')), 'old');
    assert.equal(files.get(github.clocks), 'clocks');
  });

  it("leaves the team's other state files alone", async () => {
    const files = new MemoryFiles({ [earlier('hookless.json')]: 'h', [earlier('github-sync.json.tmp')]: 't' });
    await openGithubState(files, paths);
    assert.deepEqual(files.paths(), [earlier('github-sync.json.tmp'), earlier('hookless.json')].map((path) => path.replaceAll('\\', '/')).sort());
  });

  it('lists only the state folder when nothing is left to move', async () => {
    const listed: string[] = [];
    const files: Pick<Files, 'list' | 'move'> = {
      list: async (dir) => {
        listed.push(dir);
        return ['hookless.json'];
      },
      move: async () => assert.fail('nothing to move'),
    };
    await openGithubState(files, paths);
    assert.deepEqual(listed, [paths.state]);
  });

  it('takes a move another process made first as done', async () => {
    const files = new MemoryFiles({ [earlier('github-sync.json')]: 'sync' });
    const racing: Pick<Files, 'list' | 'move'> = {
      list: (dir) => files.list(dir),
      move: async (from, to) => {
        await files.move(from, to);
        throw new Error(`${to} exists already; a move never replaces it`);
      },
    };
    await openGithubState(racing, paths);
    assert.equal(files.get(github.sync), 'sync');
  });

  it('throws a failed move that left nothing in GitHub\'s folder', async () => {
    const files = new MemoryFiles({ [earlier('github-sync.json')]: 'sync' });
    const failing: Pick<Files, 'list' | 'move'> = {
      list: (dir) => files.list(dir),
      move: async () => {
        throw new Error('EACCES');
      },
    };
    await assert.rejects(openGithubState(failing, paths), /EACCES/);
    assert.equal(files.get(earlier('github-sync.json')), 'sync');
  });
});
