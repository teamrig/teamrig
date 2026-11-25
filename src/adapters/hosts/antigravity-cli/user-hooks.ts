/**
 * teamrig's handlers in the person's own Antigravity CLI hooks file, `~/.gemini/config/hooks.json`.
 *
 * Antigravity loads named top-level hook groups from `hooks.json`, so teamrig keeps all of its handlers under the
 * `teamrig` key and leaves every other group in the file untouched.
 */

import { posix, win32 } from 'node:path';
import {
  isRecord,
  skippedUserHookLine,
  userHooksCounts,
  type HostDeps,
  type HostUserHooks,
  type JsonRecord,
  type UserHooksAnswer,
} from '../../../plugin-api/index.ts';
import { antigravityHooksFile, type HookShell } from './hooks-file.ts';
import { hostPaths } from './paths.ts';

const GROUP_NAME = 'teamrig';
const HOOKS_FILE = 'hooks.json';

function collectHandlers(group: unknown): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  if (!isRecord(group)) return found;
  for (const [event, value] of Object.entries(group)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!isRecord(entry)) continue;
      if (Array.isArray(entry['hooks'])) {
        const matcher = typeof entry['matcher'] === 'string' ? entry['matcher'] : null;
        for (const handler of entry['hooks']) addHandler(found, event, matcher, handler);
      } else {
        addHandler(found, event, null, entry);
      }
    }
  }
  return found;
}

function addHandler(found: Map<string, string>, event: string, matcher: string | null, handler: unknown): void {
  if (!isRecord(handler) || typeof handler['command'] !== 'string') return;
  const base = JSON.stringify([event, matcher, handler['command']]);
  let key = base;
  for (let repeat = 2; found.has(key); repeat += 1) key = `${base}#${repeat}`;
  found.set(key, JSON.stringify(handler));
}

function merged(current: JsonRecord, source: unknown, pluginRoot: string, shell: HookShell): UserHooksAnswer {
  const existing = current[GROUP_NAME];
  if (existing !== undefined && !isRecord(existing)) {
    return { ok: false, problem: 'the Antigravity hooks file has a non-object teamrig group' };
  }
  const built = antigravityHooksFile(source, { pluginRoot, shell, groupName: GROUP_NAME });
  if (!built.ok) {
    return { ok: false, problem: `teamrig's hooks file cannot be written for Antigravity: ${built.reason}` };
  }
  const nextGroup = built.file[GROUP_NAME] ?? {};
  const counts = userHooksCounts(collectHandlers(existing), collectHandlers(nextGroup));
  const same = counts.inserted + counts.changed + counts.removed === 0;
  return {
    ok: true,
    value: {
      file: same ? undefined : { ...current, [GROUP_NAME]: nextGroup },
      counts,
      skipped: built.skipped.map(skippedUserHookLine),
    },
  };
}

/** The Antigravity CLI port of the person's hooks file (`~/.gemini/config/hooks.json`). */
export function antigravityUserHooks(platform: HostDeps['platform']): HostUserHooks {
  const path = platform === 'win32' ? win32 : posix;
  const paths = hostPaths(platform);
  const shell: HookShell = platform === 'win32' ? 'cmd' : 'sh';
  return {
    host: 'antigravity-cli',
    file: (userHome) => path.join(paths.home(userHome), HOOKS_FILE),
    merge: (current, source, pluginRoot) => merged(current, source, pluginRoot, shell),
    afterWrite: [],
    configLines: [],
  };
}
