import { defineHost, unsupported } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { hookBridge } from "./hook-bridge.js";
import { hostPaths } from "./paths.js";
import { antigravityPermissions } from "./permissions.js";
import { statusLine } from "./status-line.js";
import { toolCallShape } from "./tool-call.js";
import { antigravityTranscriptReader } from "./transcript.js";
import { antigravityUsageMeter } from "./usage.js";
import { antigravityUserHooks } from "./user-hooks.js";
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
            transcripts: antigravityTranscriptReader,
            usage: antigravityUsageMeter,
            statusLine,
            paths: hostPaths(deps.platform),
            secrets: { secretFiles: () => [] },
            permissions: antigravityPermissions,
            plugin: unsupported('Antigravity CLI plugin store port is not built yet'),
            launcher: unsupported('Antigravity CLI session launcher port is not built yet'),
            models: unsupported('Antigravity CLI models port is not built yet'),
            steps: unsupported('Antigravity CLI steps port is not built yet'),
            userHooks: antigravityUserHooks(deps.platform),
            pluginSkills: unsupported('Antigravity CLI skills folder is not proved yet'),
        };
    },
});
