// The person's own teamrig settings (design #2253 piece B4, T5205): `<kit home>/user.json`, outside every team
// folder, so it is never synced or committed and changes only what that person's own output shows. It holds names
// only, so any key it does not know is refused rather than kept: nothing private finds a home in it by accident.
import { join } from 'node:path';
import { errorMessage, isRecord } from "../core/guards.js";
import { readLevelNamesSetting } from "../register/level-names.js";
import { ConfigReader } from "./reader.js";
export const USER_FILE_NAME = 'user.json';
/** The keys the user file may hold, each block with its own keys. */
const USER_FILE_KEYS = { levels: ['names'] };
export function userFilePath(kitHome) {
    return join(kitHome, USER_FILE_NAME);
}
/** The user file under `kitHome`; a missing one sets nothing, a broken one sets nothing and says why. */
export async function readUserFile(files, kitHome) {
    const text = await files.read(userFilePath(kitHome));
    if (text === undefined)
        return { levelNames: null, issues: [] };
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        return { levelNames: null, issues: [{ path: USER_FILE_NAME, message: `is not valid JSON (${errorMessage(error)})` }] };
    }
    if (!isRecord(raw))
        return { levelNames: null, issues: [{ path: USER_FILE_NAME, message: 'is not a JSON object' }] };
    const read = new ConfigReader();
    for (const [block, value] of Object.entries(raw)) {
        const known = USER_FILE_KEYS[block];
        if (known === undefined) {
            read.report(block, `is no user file key; it holds only ${Object.keys(USER_FILE_KEYS).join(', ')}`);
            continue;
        }
        if (!isRecord(value))
            continue;
        for (const key of Object.keys(value)) {
            if (!known.includes(key))
                read.report(`${block}.${key}`, `is no user file key; ${block} holds only ${known.join(', ')}`);
        }
    }
    const levels = read.section(raw, 'levels', '');
    const levelNames = readLevelNamesSetting(read, levels['names'], 'levels.names') ?? null;
    return { levelNames, issues: read.issues };
}
