import { defineHost, unsupported } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { codexSecretFiles } from './secret-files.ts';

/** The one reason every port gives until it is built in this folder. */
const NOT_BUILT = unsupported('not built for Codex CLI yet');

/**
 * The Codex CLI adapter. Its secret files are wired, so the secret guard keeps Codex's login and history from every
 * session; its hook input check, hooks file and reply rewrite are built beside this entry, and each other port turns
 * from unsupported to built here as it is wired to them and proved on a real Codex.
 */
export default defineHost({
  declaration,
  create: (deps) => ({
    hooks: NOT_BUILT,
    toolCall: NOT_BUILT,
    transcripts: NOT_BUILT,
    usage: NOT_BUILT,
    statusLine: NOT_BUILT,
    paths: NOT_BUILT,
    secrets: { secretFiles: () => codexSecretFiles(deps.env, deps.platform) },
    permissions: NOT_BUILT,
    plugin: NOT_BUILT,
    launcher: NOT_BUILT,
  }),
});
