/**
 * teamrig's skills in Codex CLI's own skills folder, `$CODEX_HOME/skills/teamrig` (`~/.codex` when unset).
 *
 * Codex loads no plugin's skills from the teamrig plugin, but reads every `SKILL.md` below `$CODEX_HOME/skills` in
 * every project, a nested folder too, each named by its frontmatter `name` (proved on Codex 0.171.0 with
 * `codex debug prompt-input`, T5558). `skills/.system` is Codex's own, so teamrig keeps to a folder of its own name.
 */

import { posix, win32 } from 'node:path';
import type { HostDeps, HostPluginSkills } from '../../../plugin-api/index.ts';
import { codexHomeOf } from './codex-home.ts';

const SKILLS_FOLDER = 'skills';
const TEAMRIG_FOLDER = 'teamrig';

/** The Codex CLI port of the person's skills folder. */
export function codexPluginSkills(env: HostDeps['env'], platform: HostDeps['platform']): HostPluginSkills {
  const path = platform === 'win32' ? win32 : posix;
  const codexHome = codexHomeOf(env, platform);
  return {
    host: 'codex',
    folder: (userHome) => path.join(codexHome(userHome), SKILLS_FOLDER, TEAMRIG_FOLDER),
    afterWrite: ['Codex reads its skills when a session starts: start a new Codex session to load the new ones'],
  };
}
