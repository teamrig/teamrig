import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import type { TeamPaths } from '../core/home.ts';
import { parseClocks, type Clock } from '../sync/clock.ts';
import { githubState } from './github-state.ts';

/**
 * Where an older teamrig kept the response clocks before the team's tracker-neutral replies file (T5796), newest
 * first: GitHub's connector folder (T5114), then the team's state folder. Each is format 1, read as GitHub's.
 */
export function earlierReplies(paths: TeamPaths): readonly string[] {
  return [join(githubState(paths).dir, 'clocks.json'), join(paths.state, 'github-clocks.json')];
}

/**
 * The running clocks of the team's replies file, or, while no sync has written it yet, of the newest file an older
 * teamrig left, so an upgrade keeps every clock. The older file is left where it is: a tab still running the older
 * teamrig may write it until it restarts, and nothing newer reads it once the replies file exists.
 */
export async function readReplies(files: Pick<Files, 'read'>, paths: TeamPaths): Promise<Map<string, Clock>> {
  for (const path of [paths.replies, ...earlierReplies(paths)]) {
    const text = await files.read(path);
    if (text !== undefined) {
      return parseClocks(text);
    }
  }
  return new Map();
}
