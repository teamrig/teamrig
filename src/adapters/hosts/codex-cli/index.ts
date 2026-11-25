import { defineHost, unsupported } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { hookBridge } from './hook-bridge.ts';
import { sessionLauncher } from './session-launcher.ts';
import { codexSecretFiles } from './secret-files.ts';
import { toolCallShape } from './tool-call.ts';
import { usageMeter } from './usage.ts';
import { codexPluginSkills } from './plugin-skills.ts';
import { codexUserHooks } from './user-hooks.ts';

/** The one reason every port gives until it is built in this folder. */
const NOT_BUILT = unsupported('not built for Codex CLI yet');

/**
 * The Codex CLI adapter. Its hook input and replies, its tools by kind, its usage meter, its secret files and its sessions' identity and process are wired, so the guards
 * read a Codex session's calls and the secret guard keeps Codex's login and history from every session; teamrig's
 * hooks are merged into the person's own hooks file, and each other port turns from unsupported to built here as it is wired and
 * proved on a real Codex. The manifest claims no feature until a live run proves it.
 */
export default defineHost({
  declaration,
  create: (deps) => {
    const toolCall = toolCallShape(deps.platform);
    return {
      hooks: hookBridge(toolCall),
      toolCall,
      transcripts: NOT_BUILT,
      usage: usageMeter,
      statusLine: NOT_BUILT,
      paths: NOT_BUILT,
      secrets: { secretFiles: () => codexSecretFiles(deps.env, deps.platform) },
      permissions: NOT_BUILT,
      plugin: NOT_BUILT,
      launcher: sessionLauncher(deps.env),
      models: NOT_BUILT,
      steps: NOT_BUILT,
      userHooks: codexUserHooks(deps.env, deps.platform),
      pluginSkills: codexPluginSkills(deps.env, deps.platform),
    };
  },
});
