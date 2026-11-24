import type { TranscriptSource } from '../budget/discover.ts';
import type { HostSource, ShippedHosts } from '../composition/host-ports.ts';
import type { ConfigFormat } from '../config/migrate.ts';
import type { HostCpu } from '../delivery/cpu.ts';
import type { HostMemory } from '../delivery/memory.ts';
import type { TreeState } from '../delivery/push-pass.ts';
import type { StarterWatch } from '../delivery/starter-watch.ts';
import type { StepRunner } from '../delivery/steps.ts';
import type { FileBytes } from '../core/file-bytes.ts';
import type { Files } from '../core/files.ts';
import type { Env } from '../core/home.ts';
import type { HttpClient } from '../core/http.ts';
import type { ChatWebhook } from '../core/webhook.ts';
import type { ExecPorts } from '../exec/ports.ts';
import type { Clock, Sleep } from '../core/lock.ts';
import type { PathProbe } from '../core/path-probe.ts';
import type { StoreFolders } from '../plugin-store/store.ts';
import type { CredentialStore } from '../core/credentials.ts';
import type { KeyPorts } from '../core/terminal.ts';
import type { ProgramRunner } from '../core/program-runner.ts';
import type { PullGit } from '../sync/pull-conflicts.ts';
import type { MergeGit } from '../merge/git.ts';
import type { RequirementsCheck } from '../requirements/requirements.ts';
import type { HookRunner } from '../deploy/hooks.ts';
import type { PackageRegistry } from '../package-guard/registry.ts';
import type { WorktreePorts } from '../worktree/remove.ts';
import type { RestorePorts } from '../restore/ports.ts';
import type { Processes } from '../open/processes.ts';
import type { SessionProcesses } from '../open/session-processes.ts';
import type { CommitLog } from '../push-guard/commit-size.ts';
import type { ChangeGit } from '../changes/source.ts';
import type { RepoState } from '../push-guard/push.ts';
import type { SecretsGit } from '../secret-guard/secrets-git.ts';
import type { PointerGit } from '../setup/pointer-ignore.ts';
import type { ShellRunner } from '../test-run/shell.ts';

export interface Output {
  stdout(line: string): void;
  stderr(line: string): void;
  /**
   * Aborts once stdout's reader is gone (`teamrig events --json | head -1`). A write after that is dropped without an
   * error, so a command that prints until it is stopped has only this to end on. Absent on an output that keeps its
   * lines and so cannot close: a guard's answer, a queued step's log.
   */
  readonly closed?: AbortSignal;
}

/** Where this CLI runs from, so `teamrig open` can start it again in a new tab, where the plugin's bin folder is not on PATH. */
export interface SelfLocation {
  /** The Node.js program running this CLI. */
  readonly node: string;
  /** This CLI's entry script. */
  readonly script: string;
  /** The options node took on its command line before the script (`process.execArgv`), which `teamrig exec` checks (exec/node-launch.ts). */
  readonly execArgv: readonly string[];
}

/** Everything the CLI takes from the process, as one port so every command runs in tests. */
export interface CliRuntime {
  readonly env: Env;
  readonly userHome: string;
  readonly cwd: string;
  readonly pid: number;
  readonly files: Files;
  /** Byte-exact files, for copies that must match their original (`setup backup` and `setup restore`). */
  readonly fileBytes: FileBytes;
  readonly clock: Clock;
  /** The machine's IANA time zone, which the team config's `timeZone` overrides. */
  readonly timeZone: string;
  readonly sleep: Sleep;
  /** A wait that never holds the process open (`idleSleep`, core/lock.ts): the limit `doctor` races each install probe against. */
  readonly idleSleep: Sleep;
  readonly git: RepoState;
  /** Whether git tracks or ignores a team pointer, for `team create`. */
  readonly pointerGit: PointerGit;
  /** The commits of a range, for the small-commits rule. */
  readonly commitLog: CommitLog;
  /** The staged change and the pushed commits `teamrig secrets` scans, read as the git hook that runs it sees them. */
  readonly secretsGit: SecretsGit;
  readonly out: Output;
  /**
   * Whether this run's stdin and stdout are a terminal a person types in: false under an AI CLI's shell tool or a
   * pipe, where `teamrig ui` cannot draw and opens a split of the session's terminal instead (T5105).
   */
  readonly interactive: boolean;
  readonly platform: NodeJS.Platform;
  /**
   * The ports of the AI CLI this run works in, built for an environment and platform: read them with `hostOf` (host.ts).
   * The process starts with the default host's; `runCli` swaps in the one the run names (src/cli/host-choice.ts).
   */
  readonly host: HostSource;
  /**
   * Every host adapter teamrig ships with by id, the one the run works in among them: for the host a run names
   * (`--host`), and for what holds on a machine whatever host runs the session, the hosts' own secret files
   * (`secretFilesOf`, host.ts).
   */
  readonly shippedHosts: ShippedHosts;
  /** Terminal launchers and Claude Code, for `teamrig open` and `teamrig launch`. */
  readonly processes: Processes;
  /** The running session's Claude Code process and its tab, which the automatic context refresh ends. */
  readonly sessionProcesses: SessionProcesses;
  /** The shell `teamrig test` runs its command line in. */
  readonly shell: ShellRunner;
  /** The shell `teamrig queue` runs its step in, with this process's stdio and a time limit. */
  readonly steps: StepRunner;
  /** The host's free memory, processes and commit charge, and a watch of a queued step's process tree (its ledger record). */
  readonly memory: HostMemory;
  /** The host's CPU time, which a heavy queued step's admission reads for idle CPU (T2700). */
  readonly cpu: HostCpu;
  /** The processes that started this one, so a queued step whose launching shell was ended stops too. */
  readonly starters: StarterWatch;
  /** Runs the command-line tool of a connector adapter, such as `gh`, each run held to the two connector limits of time and output (plugin-api/connector.ts). */
  readonly run: ProgramRunner;
  /** The system's saved secrets, where `teamrig issue sync` finds each owner's read-only GitHub token; only ever read. */
  readonly credentials: CredentialStore;
  /** The writes to those secrets and the person's terminal, for `teamrig key` alone. */
  readonly keys: KeyPorts;
  /** The API of an outside tool a connector adapter reaches with no command line (plugin-api/connector.ts): https only. */
  readonly http: HttpClient;
  /** Whether a folder or a program is there. */
  readonly probe: PathProbe;
  /** The plugin store's file and folder times, which the idle pass reads before it reopens a session. */
  readonly pluginStore: StoreFolders;
  readonly self: SelfLocation;
  /** The Claude Code transcripts `teamrig budget` measures: their folders and bytes. */
  readonly transcripts: TranscriptSource;
  /** What teamrig needs beside itself (git, Claude Code, Node.js) and lacks: told at session start, by `team create` and by `doctor`. */
  readonly requirements: RequirementsCheck;
  /** The git and file steps `teamrig worktree remove` takes. */
  readonly worktrees: WorktreePorts;
  /** The shutdown log and the countdown of the restore after a reboot. */
  readonly restore: RestorePorts;
  /** The working tree `teamrig queue --pre-push` checks: clean or changed, and HEAD's tree. */
  readonly trees: TreeState;
  /** The git steps `teamrig merge` takes. */
  readonly mergeGit: MergeGit;
  /** The project history `teamrig changes` reads: commits in a range and the release index, read-only. */
  readonly changeGit: ChangeGit;
  /** The git steps `teamrig pr conflicts` takes: a pull request's head fetched and merged in the object store alone. */
  readonly pulls: PullGit;
  /** The programs `teamrig deploy` runs, its checks, afterPull hooks and deploy command: no shell, each with a time limit. */
  readonly hooks: HookRunner;
  /** The registry the package guard asks about the versions an install names: their publish times and advisories. */
  readonly packageRegistry: PackageRegistry;
  /** The process `teamrig exec` runs a reviewed command in, and the git checkout its binding check reads. */
  readonly exec: ExecPorts;
  /** The chat webhook `teamrig exec` posts its reviews and runs to, and an expired login's page goes to. */
  readonly webhook: ChatWebhook;
  /** The config format the run reads and migrates to; default the shipped one (tests give a newer release's). */
  readonly configFormat?: ConfigFormat;
  /** When a hook's every file lock wait gives up (hook-timeouts.ts); runCli sets it for a `hook` command. */
  readonly lockDeadline?: number | undefined;
  /** The event a hook's `--host-event` named, for a host whose hook input names none; runCli sets it for a `hook` command. */
  readonly hostEvent?: string | undefined;
  /** cmd.exe's whole command line, which the `teamrig.cmd` shim passes, for the arguments cmd cut at a line break (cmd-shim.ts). */
  readonly cmdShimLine?: string | undefined;
  /** All of stdin, for hooks, which Claude Code feeds one JSON object. */
  readStdin(): Promise<string>;
  /** A new unique id, such as a host lock's token. */
  newId(): string;
}

/**
 * Exit codes: 0 done, 1 failed, 2 refused by a team rule, 3 `teamrig open` found no terminal to open and
 * printed the command to run instead, 4 `/teamrig` printed the line the person must agree to before it runs
 * (`hook slash-command`, src/mod/slash-hand.ts asks), 64 a command line it cannot read, 75 `teamrig merge`'s merge
 * command waits (run it again once the branch is merged).
 */
/** `wake` is a background hook's exit 2: with `asyncRewake`, Claude Code gives the model what it printed to stderr as a new turn. */
export const EXIT = { ok: 0, failed: 1, refused: 2, wake: 2, printed: 3, ask: 4, usage: 64, waiting: 75 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** A request the team's rules or state refuse: printed as `REFUSED <reason>`, exit 2. */
export class RefusedError extends Error {
  override readonly name = 'RefusedError';
}
