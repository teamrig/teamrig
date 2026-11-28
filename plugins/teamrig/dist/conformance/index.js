/**
 * The conformance kit: the cases every adapter of a port must pass, held as values so the same case runs an adapter
 * inside teamrig and an outside program reached through the protocol. It imports the plugin API, `node:assert` and
 * its own folder, nothing else, so it ships as it is to whoever builds a host or a connector.
 */
import { LAUNCHER_CONTRACT } from "./host/launcher.js";
import { PERMISSION_MODE_CONTRACT } from "./host/permission-mode.js";
import { PERMISSIONS_CONTRACT } from "./host/permissions.js";
import { MODELS_CONTRACT } from "./host/models.js";
import { STEPS_CONTRACT } from "./host/steps.js";
import { PLUGIN_CONTRACT } from "./host/plugin.js";
import { STATUS_LINE_CONTRACT } from "./host/status-line.js";
import { TRANSCRIPT_CONTRACT } from "./host/transcript.js";
import { USAGE_CONTRACT } from "./host/usage.js";
import { entryOf } from "./kit.js";
import { TERMINAL_CONTRACT } from "./terminal/terminal.js";
import { TRACKER_CONTRACT } from "./connector/tracker.js";
import { TRACKER_READS_CONTRACT } from "./connector/reads.js";
export { bind, defineContract, osOf, runCases } from "./contract.js";
export { choiceOf } from "./choice.js";
export { entryOf, kitProblems } from "./kit.js";
export { TERMINAL_CONTRACT } from "./terminal/terminal.js";
export { nothingTerminal, referenceTerminal, yesTerminal } from "./terminal/reference.js";
export { nothingTranscripts, TRANSCRIPT_CONTRACT, yesTranscripts } from "./host/transcript.js";
export { nothingUsage, USAGE_CONTRACT, yesUsage } from "./host/usage.js";
export { nothingStatusLine, STATUS_LINE_CONTRACT, yesStatusLine } from "./host/status-line.js";
export { nothingPermissions, PERMISSIONS_CONTRACT, yesPermissions } from "./host/permissions.js";
export { nothingPlugin, PLUGIN_CONTRACT, yesPlugin } from "./host/plugin.js";
export { PERMISSION_MODE_CONTRACT, nothingPermissionMode, yesPermissionMode } from "./host/permission-mode.js";
export { MODELS_CONTRACT, nothingModels, yesModels } from "./host/models.js";
export { STEPS_CONTRACT, nothingSteps, yesSteps } from "./host/steps.js";
export { TRACKER_CONTRACT } from "./connector/tracker.js";
export { nothingTracker, referenceTracker, TRACKER_WRITES, yesTracker } from "./connector/reference.js";
export { TRACKER_READS_CONTRACT } from "./connector/reads.js";
export { nothingReads, READS_LIES, referenceReads, yesReads } from "./connector/reads-reference.js";
export { LAUNCHER_CONTRACT, nothingLauncher, yesLauncher } from "./host/launcher.js";
/**
 * Every contract of the kit. A port's contract lives in its own file, under `host/`, `connector/` or `terminal/`,
 * and is listed here with one `entryOf(...)` line at the end, so two changes adding contracts never touch the same
 * lines.
 */
export const CONTRACTS = [
    entryOf(TERMINAL_CONTRACT),
    entryOf(TRANSCRIPT_CONTRACT),
    entryOf(USAGE_CONTRACT),
    entryOf(STATUS_LINE_CONTRACT),
    entryOf(PERMISSIONS_CONTRACT),
    entryOf(PLUGIN_CONTRACT),
    entryOf(MODELS_CONTRACT),
    entryOf(STEPS_CONTRACT),
    entryOf(LAUNCHER_CONTRACT),
    entryOf(TRACKER_CONTRACT),
    entryOf(PERMISSION_MODE_CONTRACT),
    entryOf(TRACKER_READS_CONTRACT),
];
