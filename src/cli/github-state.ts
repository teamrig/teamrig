import { basename, join } from 'node:path';
import type { Files } from '../core/files.ts';
import type { TeamPaths } from '../core/home.ts';
import { connectorState, type ConnectorState } from './connector-state.ts';

/** GitHub's connector id, so its state lives in `<state>/connectors/github` like any connector's. */
export const GITHUB_CONNECTOR_ID = 'github';

/**
 * Each file GitHub kept straight in the team's state folder before it had its own (T5114), with the path that holds
 * it now. The two locks are left where they are: a lock lives only while its holder runs, and moving one would take
 * it from a teamrig of the older version that still holds it.
 */
const EARLIER_NAMES: ReadonlyArray<readonly [string, keyof ConnectorState]> = [
  ['github-sync.json', 'sync'],
  ['github-ci', 'ci'],
  ['github-push-hour.json', 'pushHour'],
  ['github-clocks.json', 'clocks'],
  ['github-watch.json', 'watch'],
  ['github-claims.json', 'claims'],
  ['github-follows.json', 'follows'],
];

/**
 * GitHub's state paths, after moving any file an older teamrig left in the team's state folder into GitHub's own.
 * It costs one folder listing while nothing is left to move. A file already in GitHub's folder wins over the older
 * one, which stays where it is: a tab still running the older teamrig may write it until it restarts, and nothing
 * newer reads it.
 */
export async function openGithubState(files: Pick<Files, 'list' | 'move'>, paths: TeamPaths): Promise<ConnectorState> {
  const state = connectorState(paths, GITHUB_CONNECTOR_ID);
  const left = new Set(await files.list(paths.state));
  const moves = EARLIER_NAMES.filter(([name]) => left.has(name));
  if (moves.length === 0) {
    return state;
  }
  const held = new Set(await files.list(state.dir));
  for (const [name, key] of moves) {
    const to = state[key];
    if (held.has(basename(to))) {
      continue;
    }
    try {
      await files.move(join(paths.state, name), to);
    } catch (error) {
      // Another process moved it first; any other failure is real.
      if (!(await files.list(state.dir)).includes(basename(to))) {
        throw error;
      }
    }
  }
  return state;
}
