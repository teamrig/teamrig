/**
 * The plugin API: everything an adapter may import from teamrig. An adapter imports this file and its own folder,
 * nothing else, so moving one out of the repo changes no line of it but this import.
 */
export { API_VERSION, apiVersionNotice, isApiVersion } from "./version.js";
export { OSES, isManifest, isOs, isProofRef, isSupport, manifestProblems, provedOn, supportProblem } from "./support.js";
export { ADAPTER_ID, adapterEntry, declarationProblems } from "./declaration.js";
export { defineHost, hostAdapterProblems, hostDeclarationProblems, isHostAdapter, isHostDeclaration } from "./host.js";
export { CONNECTOR_RUN_MAX_BYTES, CONNECTOR_RUN_TIMEOUT_MS, connectorAdapterProblems, connectorDeclarationProblems, defineConnector, isConnectorAdapter, isConnectorDeclaration, } from "./connector.js";
export { PANE_STATES, TERMINAL_REQUESTS, isPaneState, isTerminalRequest, } from "./terminal.js";
export { defineTerminal, isTerminalAdapter, isTerminalDeclaration, terminalAdapterProblems, terminalDeclarationProblems, } from "./terminal-adapter.js";
export { CONNECTOR_FEATURES, CONNECTOR_KINDS, HOST_FEATURES, TERMINAL_FEATURES, featuresOf, isConnectorFeatureId, isConnectorKind, isHostFeatureId, isTerminalFeatureId, } from "../features/registry.js";
export { HOOK_EVENTS, INPUT_ORIGINS, SHELL_DIALECTS, TOOL_KINDS, isHookEventName, isToolKind, isUnsupported, unsupported, } from "../ports/host/index.js";
// What an adapter reads outside JSON with, an API's answer or a host's own line: it is narrowed, never cast. And a
// thrown value's code and text.
export { errorCode, errorMessage, instantField, isNonNegativeInteger, isRecord, isStringArray, numberField, recordField, stringField, } from "../core/guards.js";
// Outside text as one printable line: what a connector puts of a tool's answer into a line a person reads.
export { plainLine } from "../core/printable.js";
// The interface version this teamrig serves: a protocol adapter sends it and holds an outside program's answers to its major.
export { INTERFACE_MAJOR, INTERFACE_VERSION, parseInterfaceVersion } from "../interface/version.js";
// The footer of a text a connector posts: put on, taken off a text already stamped, and its parts for a tool with no Markdown.
export { stampCredit, withStampFooter, withoutStampFooter } from "../core/stamp.js";
// Whether a comment's text is a claim line: a tracker matches it as it reads the comment, and drops the text.
export { isClaim } from "../issues/claim.js";
export { parseRef } from "../issues/ref.js";
export { issuePage, targetText, } from "../issues/host.js";
// A repository's label file, and the labels teamrig keeps: the only labels a tracker may make.
export { LABEL_FILE, parseLabelFile } from "../issues/label-file.js";
export { areaLabelSpec, MANAGED_LABEL_SPECS } from "../issues/managed-labels.js";
// The shape of an account name, checked before one is put into a request.
export { isLogin } from "../issues/login.js";
// How far a scan of mentions and reviews reads: a connector pages by them, and the scan's caller counts by them.
export { MENTION_PAGE_SIZE, MENTION_PAGES_MAX, REVIEW_READS_MAX } from "../issues/scan-caps.js";
// The name an owner's key is saved under.
export { tokenName } from "../issues/token-names.js";
// The length a posted comment is held to, and why a label may not be written.
export { labelRefusal, MAX_COMMENT } from "../issues/write.js";
// How a program ended, as a failure line words it.
export { exitText } from "../open/processes.js";
export { ProgramOutputCapError } from "../core/program-runner.js";
