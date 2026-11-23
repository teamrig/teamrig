import { defineHost, unsupported } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { hookBridge } from './hook-bridge.ts';
import { hostPaths } from './paths.ts';
import { antigravityPermissions } from './permissions.ts';
import { statusLine } from './status-line.ts';
import { toolCallShape } from './tool-call.ts';
import { antigravityUserHooks } from './user-hooks.ts';

/**
 * The Antigravity host adapter: translates Antigravity's `hooks.json` lifecycle events, tool call shapes, and
 * workspace/config paths for teamrig. Ports not yet wired for Antigravity return `unsupported(...)`.
 */
export default defineHost({
  declaration,
  create: (deps) => {
    const toolCall = toolCallShape(deps.platform);
    return {
      hooks: hookBridge(toolCall),
      toolCall,
      transcripts: unsupported('Antigravity transcript reader is not wired yet'),
      usage: unsupported('Antigravity has no usage meter wired yet'),
      statusLine,
      paths: hostPaths(deps.platform),
      secrets: { secretFiles: () => [] },
      permissions: antigravityPermissions,
      plugin: unsupported('Antigravity CLI plugin store port is not built yet'),
      launcher: unsupported('Antigravity CLI session launcher port is not built yet'),
      models: unsupported('Antigravity CLI models port is not built yet'),
      steps: unsupported('Antigravity CLI steps port is not built yet'),
      userHooks: antigravityUserHooks(deps.platform),
    };
  },
});
