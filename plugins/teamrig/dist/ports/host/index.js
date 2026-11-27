export { HOOK_EVENTS, isHookEventName } from "./hook-bridge.js";
export { SHELL_DIALECTS, TOOL_KINDS, isToolKind, } from "./tool-call.js";
export { isUnsupported, unsupported } from "./unsupported.js";
export { OBSERVED_FROM, UNKNOWN_WHY, hostCannotTell, knownFrom } from "./known.js";
export { PERMISSION_MODES, effectiveOf, observedPermission } from "./permission-mode.js";
export { skippedUserHookLine, userHooksCounts, } from "./user-hooks.js";
/** The name of every host port, held to {@link HostPorts} by its type: a port added there is a line missing here. */
const NAMED = { hooks: true, toolCall: true, transcripts: true, usage: true, statusLine: true, paths: true, secrets: true, permissions: true, plugin: true, launcher: true, models: true, steps: true, userHooks: true, pluginSkills: true };
export const HOST_PORT_NAMES = Object.keys(NAMED);
export { INPUT_ORIGINS, } from "./transcript-reader.js";
