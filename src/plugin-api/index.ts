/**
 * The plugin API: everything an adapter may import from teamrig. An adapter imports this file and its own folder,
 * nothing else, so moving one out of the repo changes no line of it but this import.
 */
export { API_VERSION, apiVersionNotice, isApiVersion } from './version.ts';
export { OSES, isManifest, isOs, isProofRef, isSupport, manifestProblems, provedOn, supportProblem, type Manifest, type Os, type ProofRef, type Support } from './support.ts';
export { ADAPTER_ID, adapterEntry, declarationProblems, type AdapterDeclaration, type AdapterEntry, type EntryFunction } from './declaration.ts';
export { defineHost, hostAdapterProblems, hostDeclarationProblems, isHostAdapter, isHostDeclaration, type HostAdapter, type HostDeclaration, type HostDeps } from './host.ts';
export { HOST_PORT_FEATURES, isHostPortName, portFeatureProblems } from './port-features.ts';
export {
  CONNECTOR_RUN_MAX_BYTES,
  CONNECTOR_RUN_TIMEOUT_MS,
  connectorAdapterProblems,
  connectorDeclarationProblems,
  defineConnector,
  isConnectorAdapter,
  isConnectorDeclaration,
  type ConfigReport,
  type ConnectorAdapter,
  type ConnectorDeclaration,
  type ConnectorDeps,
  type ConnectorPorts,
  type ConnectorSpec,
  type RefCodec,
} from './connector.ts';
export {
  PANE_STATES,
  TERMINAL_REQUESTS,
  isPaneState,
  isTerminalRequest,
  KIT_MODE_ENV,
  KIT_REQUESTS,
  isKitRequest,
  type KitRequest,
  type ShownPane,
  type TerminalWorld,
  type DeliverAnswer,
  type HeldWhy,
  type IdleAnswer,
  type ListAnswer,
  type ListedPane,
  type OpenAnswer,
  type PaneAnswer,
  type PaneIdentity,
  type PaneOpen,
  type PaneSplit,
  type PaneState,
  type SplitAnswer,
  type TerminalCapabilities,
  type TerminalFailure,
  type TerminalPort,
  type TerminalRequest,
  type Unserved,
  type Wake,
} from './terminal.ts';
export {
  defineTerminal,
  isTerminalAdapter,
  isTerminalDeclaration,
  terminalAdapterProblems,
  terminalDeclarationProblems,
  type TerminalAdapter,
  type TerminalDeclaration,
  type TerminalDeps,
  type TerminalPorts,
} from './terminal-adapter.ts';
export {
  CONNECTOR_FEATURES,
  CONNECTOR_KINDS,
  HOST_FEATURES,
  TERMINAL_FEATURES,
  featuresOf,
  isConnectorFeatureId,
  isConnectorKind,
  isHostFeatureId,
  isTerminalFeatureId,
  type ConnectorFeatureId,
  type ConnectorKind,
  type FeatureId,
  type FeatureIdOf,
  type FeatureRow,
  type FeatureSide,
  type HostFeatureId,
  type TerminalFeatureId,
  type Toggle,
} from '../features/registry.ts';
// The steps an adapter may serve as text, and the record of its texts a declaration's `steps` need.
export type { StepId, StepIdOf, StepTexts } from '../features/steps.ts';
export {
  HOOK_EVENTS,
  INPUT_ORIGINS,
  SHELL_DIALECTS,
  TOOL_KINDS,
  isHookEventName,
  isToolKind,
  isUnsupported,
  unsupported,
  type AskCall,
  type BackgroundMark,
  type CallUsage,
  type ChannelAnswer,
  type ChannelPlan,
  type ChildEnvironment,
  type CompactEntry,
  type ContinuedEntry,
  type EditCall,
  type EditedFile,
  type EntryKind,
  type EntryThread,
  type EnvironmentEntry,
  type FolderSettings,
  type HelperCall,
  type HookBridge,
  type HookEvent,
  type HookEventName,
  type HookHelper,
  type HookNoteEntry,
  type HookReply,
  type HookVerdict,
  type HostModels,
  type HostPaths,
  type HostPermissions,
  type HostPlugin,
  type HostPluginSkills,
  type HostSteps,
  type HostPorts,
  type HostSecrets,
  type HookLauncher,
  type HostUserHooks,
  type InputEntry,
  type InputOrigin,
  type InstallReach,
  type KitLauncherLines,
  type MarketplaceRef,
  type MarketplaceSource,
  type MessageCall,
  type ModelSwitchEntry,
  type OtherEntry,
  type PermissionsAnswer,
  type PermissionsReading,
  type PlainCall,
  type PluginInstall,
  type QueuedPromptEntry,
  type ReadCall,
  type ReplyCall,
  type ReplyEntry,
  type RoutingOverride,
  type RunningProgram,
  type ScheduledCarryEntry,
  type ScheduledJob,
  type SearchCall,
  type SessionIdentity,
  type SessionLauncher,
  type SandboxKind,
  type SessionPlace,
  type SessionRestriction,
  type SessionStart,
  type SessionVariables,
  type SessionWake,
  type ShellCall,
  type ShellDialect,
  type SkillCall,
  type StatusLine,
  type StatusLineAnswer,
  type StatusLinePlan,
  type StatusReading,
  type TextChange,
  type TextReplacement,
  type TitleEntry,
  type TitleSwitch,
  type DatedRateLimits,
  type RateLimits,
  type RateWindow,
  type TokenWeights,
  type ToolCall,
  type ToolCallShape,
  type ToolKind,
  type ToolOutcome,
  type TranscriptEntry,
  type TranscriptReader,
  type TrustedRoutesPlan,
  type TurnEndEntry,
  type UnreadLine,
  type Unsupported,
  type UsageMeter,
  skippedUserHookLine,
  userHooksCounts,
  type SkippedUserHook,
  type UserHooksAnswer,
  type UserHooksCounts,
  type UserHooksPlan,
  type WakeDelivery,
  type WebCall,
  type ConfigLinesAnswer,
  type HostConfigFileSet,
  type HostConfigLines,
  OBSERVED_FROM,
  PERMISSION_MODES,
  UNKNOWN_WHY,
  effectiveOf,
  hostCannotTell,
  knownFrom,
  observedPermission,
  type EffectiveConfig,
  type Known,
  type MappedPermissionMode,
  type ObservedFrom,
  type ObservedPermission,
  type PermissionMode,
  type UnknownWhy,
} from '../ports/host/index.ts';
export type { CredentialRead, CredentialStore } from '../core/credentials.ts';
// What an adapter reads outside JSON with, an API's answer or a host's own line: it is narrowed, never cast. And a
// thrown value's code and text.
export {
  errorCode,
  errorMessage,
  instantField,
  isNonNegativeInteger,
  isRecord,
  isStringArray,
  numberField,
  recordField,
  stringField,
  type JsonRecord,
} from '../core/guards.ts';
export type { Env } from '../core/home.ts';
// git's credential helper protocol: what a connector answers git's `get` with, and where its helper is wired.
export { CREDENTIAL_QUIT, credentialAnswer, type CredentialAsk, type HelperScope, type HelperSkip } from '../core/git-credential.ts';
export type { HttpClient, HttpMethod, HttpRequest, HttpResult } from '../core/http.ts';
// Which saved key reaches a target: the narrowest scope's credential first, a failed read never falling to a wider one.
export { pickKey, type KeyCandidate, type KeyPick } from '../core/key-pick.ts';
// Outside text as one printable line: what a connector puts of a tool's answer into a line a person reads.
export { plainLine } from '../core/printable.ts';
// The interface version this teamrig serves: a protocol adapter sends it and holds an outside program's answers to its major.
export { INTERFACE_MAJOR, INTERFACE_VERSION, parseInterfaceVersion } from '../interface/version.ts';
// The footer of a text a connector posts: put on, taken off a text already stamped, and its parts for a tool with no Markdown.
export { stampCredit, withStampFooter, withoutStampFooter, type StampCredit } from '../core/stamp.ts';
// A host's own folder an environment variable moved, as the secret guard's globs of its secret files there.
export { folderGlob, movedFolderSecrets } from '../secret-guard/folder-glob.ts';
// Whether a comment's text is a claim line: a tracker matches it as it reads the comment, and drops the text.
export { isClaim } from '../issues/claim.ts';
// A tracker as the public interface's documents name it, and the issue a task's ref names: a tracker's adapter builds
// the first from the second.
export type { Connector, ConnectorItem, ConnectorName } from '../interface/connector.ts';
export { parseRef } from '../issues/ref.ts';
export type { FieldKind, FieldValue, FieldedIssue, HostField, HostFieldRead, IssueFields } from '../issues/fields.ts';
export {
  issuePage,
  targetText,
  SEARCH_PAGE,
  type CloseReason,
  type CodeHost,
  type FoundIssue,
  type HostAssignee,
  type HostComments,
  type HostCommit,
  type HostCommitFile,
  type HostEnd,
  type HostIssueId,
  type HostIssueLabels,
  type HostJobLog,
  type HostLabel,
  type HostLabelFile,
  type HostLinks,
  type HostList,
  type HostRerun,
  type HostSearch,
  type HostLanding,
  type HostOpen,
  type HostPulls,
  type HostPullFiles,
  type HostPullStand,
  type HostPullWork,
  type HostReach,
  type HostThread,
  type HostUse,
  type HostViewer,
  type HostWatch,
  type IssueDraft,
  type IssueHost,
  type IssueQuery,
  type IssueReopen,
  type IssueSearch,
  type IssueTarget,
  type LabelSpec,
  type PullLanding,
  type PullStand,
  type Reopenable,
  type Searchable,
  type Tracker,
  type WatchMarks,
} from '../issues/host.ts';
// The scope a tracker's list may be asked with: which of a place's issues the import takes (sync/scope.ts).
export type { AssignedScope, ImportScope, ScopeRequest } from '../sync/scope.ts';
// A tracker's trust rule: whose issues become tasks as written, judged the same for every connector (sync/trust-rule.ts).
export { judgeTrust, resolveTrust } from '../sync/trust-rule.ts';
export type { ResolvedTrust, SiteTrust, TrustAuthor, TrustDefaults, TrustEditors, TrustEdits, TrustFacts, TrustLevel, TrustMatcher, TrustVerdict } from '../sync/trust-rule.ts';
export { NO_TRUST_RULE, parseTrustRule, type TrustSyntax } from '../sync/trust-config.ts';
export type { HostIssue, IssueComment, IssueState, IssueThread, LabelEvent, LinkedIssue, ReadComment } from '../issues/issue.ts';
// A repository's label file, and the labels teamrig keeps: the only labels a tracker may make.
export { LABEL_FILE, parseLabelFile } from '../issues/label-file.ts';
export { areaLabelSpec, MANAGED_LABEL_SPECS } from '../issues/managed-labels.ts';
// The shape of an account name, checked before one is put into a request.
export { isLogin } from '../issues/login.ts';
export type { HostPost, HostPosts } from '../issues/post.ts';
export type { FailedJob, HostPull, PullChecks, PullMergeable, PullReview, PullState } from '../issues/pull.ts';
// How far a scan of mentions and reviews reads: a connector pages by them, and the scan's caller counts by them.
export { MENTION_PAGE_SIZE, MENTION_PAGES_MAX, REVIEW_READS_MAX } from '../issues/scan-caps.ts';
// The names an owner's key, and one repository's own key, are saved under.
export { repoTokenName, tokenName } from '../issues/token-names.ts';
// The length a posted comment is held to, and why a label may not be written.
export { labelRefusal, MAX_COMMENT } from '../issues/write.ts';
// How a program ended, as a failure line words it; what a terminal's adapter starts its launcher and runs its programs
// with, and how long a launcher may take to return.
export {
  EXIT_WAIT_MS,
  exitText,
  type LaunchEnd,
  type RunOutcome,
  type RunRequest,
  type StartMode,
  type StartOutcome,
  type StartRequest,
  type TerminalProcesses,
} from '../open/processes.ts';
// A script for Windows PowerShell as one program run, and a command made into a shell's or a Windows command line's text.
export { powerShellRequest, type PowerShellRequest } from '../core/powershell.ts';
export { shellCommand, windowsCommandLine } from '../open/quote.ts';
export { ProgramOutputCapError, type ProgramRequest, type ProgramResult, type ProgramRunner } from '../core/program-runner.ts';
export type { SecretScanner } from '../core/secrets.ts';
export type { ShellEnd } from '../core/shell-end.ts';
