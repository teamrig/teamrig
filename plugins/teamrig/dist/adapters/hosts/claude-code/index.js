import { defineHost, unsupported } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { hookBridge } from "./hook-bridge.js";
import { hostModels } from "./models.js";
import { hostPaths } from "./paths.js";
import { hostPermissions } from "./permissions.js";
import { hostPlugin } from "./plugin.js";
import { hostSecrets } from "./secret-files.js";
import { sessionLauncher } from "./session-launcher.js";
import { statusLine } from "./status-line.js";
import { hostSteps } from "./steps.js";
import { toolCallShape } from "./tool-call.js";
import { transcriptReader } from "./transcript.js";
import { usageMeter } from "./usage.js";
/**
 * The Claude Code adapter: its hook input and replies, its tools by kind, its transcripts, what its calls cost, its
 * status line, where it keeps its files, which of them are secrets, its permission rules, its plugin store, who it
 * says a run is, its models and the steps its person types. Each further port moves here from the core as the port
 * split names it.
 */
/** Claude Code runs teamrig's hooks from the installed plugin itself, so no hooks file of the person's needs them. */
const PLUGIN_HOOKS = unsupported("Claude Code runs teamrig's hooks from its plugin");
const PLUGIN_SKILLS = unsupported("Claude Code loads teamrig's skills from its plugin");
export default defineHost({
    declaration,
    create: (deps) => {
        const toolCall = toolCallShape(deps.platform);
        return {
            hooks: hookBridge(toolCall),
            toolCall,
            transcripts: transcriptReader,
            usage: usageMeter,
            statusLine,
            paths: hostPaths(deps.env, deps.platform),
            secrets: hostSecrets(deps.env, deps.platform),
            permissions: hostPermissions,
            plugin: hostPlugin,
            launcher: sessionLauncher(deps.env),
            models: hostModels,
            steps: hostSteps,
            userHooks: PLUGIN_HOOKS,
            pluginSkills: PLUGIN_SKILLS,
        };
    },
});
