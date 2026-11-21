import { movedFolderSecrets, type HostDeps } from '../../../plugin-api/index.ts';

/** Moves Codex's own folder (config, login, history, sessions) away from `~/.codex`. */
const HOME_VAR = 'CODEX_HOME';
/**
 * The files in Codex's own folder whose content is a secret: its login (`auth.json`, where `cli_auth_credentials_store`
 * keeps it in a file), every prompt a person typed (`history.jsonl`), and the local secret store (`secrets/`), whose
 * key sits in the person's OS keyring, which any command the person runs can read. Its `.env` is already a default
 * secret of the guard, as every `.env` is.
 */
const OWN_FOLDER_SECRETS = ['auth.json', 'history.jsonl', 'secrets/**'] as const;

/**
 * Codex's files whose content is a secret, as the secret guard's globs: those of its own folder where it is by
 * default, its login in any folder named like its own (`.codex-work`): a second account's folder, or one this run's
 * environment does not name, and those of the folder `CODEX_HOME` moves it to. The default place stays named when
 * the folder is moved: the files of an earlier run may still be there.
 */
export function codexSecretFiles(env: HostDeps['env'], platform: HostDeps['platform']): readonly string[] {
  return [...OWN_FOLDER_SECRETS.map((name) => `~/.codex/${name}`), '**/.codex*/auth.json', ...movedFolderSecrets(env[HOME_VAR], OWN_FOLDER_SECRETS, platform)];
}
