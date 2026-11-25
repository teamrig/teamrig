import { movedFolderSecrets, type HostDeps, type HostSecrets } from '../../../plugin-api/index.ts';

/** Moves Claude Code's own folder (settings, plugins, transcripts) away from `~/.claude`. */
const CONFIG_DIR = 'CLAUDE_CONFIG_DIR';
/** The files in Claude Code's own folder whose content is a secret: its login, and every prompt a person typed. */
const OWN_FOLDER_SECRETS = ['.credentials.json', 'history.jsonl'] as const;
/**
 * Claude Code's files whose content is a secret, as the secret guard's globs: those of its own folder where it is
 * by default, a folder's local settings, whose allow rules keep a command allowed once, a credential in it too, and
 * its login in any folder named like its own (`.claude-work`, `.claude2`): a second account's folder, or one this
 * run's environment does not name. A search's wildcards are read against these alone: were the login listed in
 * every folder here, the guard would read each search of `*.json` files as one of a login.
 */
const SECRET_FILES: readonly string[] = [
  ...OWN_FOLDER_SECRETS.map((name) => `~/.claude/${name}`),
  '**/.claude/settings.local.json',
  '**/.claude*/.credentials.json',
];
/** The login in any folder, counted where a word spells its name out: a second profile kept in a folder of any name. */
const NAMED_FILES: readonly string[] = ['**/.credentials.json'];

/** Claude Code's secret files in the environment of one run on `platform`. */
export function hostSecrets(env: HostDeps['env'], platform: HostDeps['platform']): HostSecrets {
  return {
    // The default place stays named when the folder is moved: the files of an earlier run may still be there.
    secretFiles: () => [...SECRET_FILES, ...movedFolderSecrets(env[CONFIG_DIR], OWN_FOLDER_SECRETS, platform)],
    namedFiles: () => NAMED_FILES,
  };
}
