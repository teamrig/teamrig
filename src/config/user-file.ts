// The person's own teamrig settings (design #2253 piece B4, T5205): `<kit home>/user.json`, outside every team
// folder, so it is never synced or committed and changes only what that person's own output shows. It holds names
// only, so any key it does not know is refused rather than kept: nothing private finds a home in it by accident.
import { join } from 'node:path';
import { errorMessage, isRecord } from '../core/guards.ts';
import type { Files } from '../core/files.ts';
import { readLevelNamesSetting, type LevelNamesSetting } from '../register/level-names.ts';
import { ConfigReader, type ConfigIssue } from './reader.ts';

export const USER_FILE_NAME = 'user.json';

/** The keys the user file may hold, each block with its own keys. */
const USER_FILE_KEYS: Readonly<Record<string, readonly string[]>> = { levels: ['names'] };

export interface UserFile {
  /** The person's own `levels.names`; null when the file sets none or sets one that is refused. */
  readonly levelNames: LevelNamesSetting | null;
  /** What was refused, each with its path in the file; empty for a missing file. */
  readonly issues: readonly ConfigIssue[];
}

export function userFilePath(kitHome: string): string {
  return join(kitHome, USER_FILE_NAME);
}

/** The user file under `kitHome`; a missing one sets nothing, a broken one sets nothing and says why. */
export async function readUserFile(files: Files, kitHome: string): Promise<UserFile> {
  const text = await files.read(userFilePath(kitHome));
  if (text === undefined) return { levelNames: null, issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { levelNames: null, issues: [{ path: USER_FILE_NAME, message: `is not valid JSON (${errorMessage(error)})` }] };
  }
  if (!isRecord(raw)) return { levelNames: null, issues: [{ path: USER_FILE_NAME, message: 'is not a JSON object' }] };
  const read = new ConfigReader();
  for (const [block, value] of Object.entries(raw)) {
    const known = USER_FILE_KEYS[block];
    if (known === undefined) {
      read.report(block, `is no user file key; it holds only ${Object.keys(USER_FILE_KEYS).join(', ')}`);
      continue;
    }
    if (!isRecord(value)) continue;
    for (const key of Object.keys(value)) {
      if (!known.includes(key)) read.report(`${block}.${key}`, `is no user file key; ${block} holds only ${known.join(', ')}`);
    }
  }
  const levels = read.section(raw, 'levels', '');
  const levelNames = readLevelNamesSetting(read, levels['names'], 'levels.names') ?? null;
  return { levelNames, issues: read.issues };
}
