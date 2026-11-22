import { CHANGE_SOURCE_IDS } from "./ids.js";
import { GIT_SOURCE } from "./sources/git.js";
import { NOTES_SOURCE } from "./sources/notes.js";
import { REGISTER_SOURCE } from "./sources/register.js";
const BY_ID = { notes: NOTES_SOURCE, register: REGISTER_SOURCE, git: GIT_SOURCE };
/** Every change source, in `CHANGE_SOURCE_IDS` order. */
export const CHANGE_SOURCES = CHANGE_SOURCE_IDS.map((id) => BY_ID[id]);
