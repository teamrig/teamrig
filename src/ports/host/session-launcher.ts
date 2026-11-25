/**
 * The host's sessions as the core starts, finds and names them. So far the port tells the program's name, who the
 * host says a run is, what a child inherits of a session, which process runs one and what its command line says (a
 * fork, a background job), where a session ran, the program and arguments that start or resume one, and how the host
 * hands a running session a prompt from outside its tab (a wake).
 */

import type { ProgramResult } from '../../core/program-runner.ts';
import type { Unsupported } from './unsupported.ts';

/**
 * What the host tells a run about the session that started it. A host tells it its own way (Claude Code in the
 * environment of its hooks and of what its tools run), so the core asks here and reads no variable of a host.
 */
export interface SessionIdentity {
  /**
   * The folder the host started the session in, which stays put through a `cd` or a worktree: where a command run
   * from a subfolder finds its team, and where a session is resumed from. Undefined when the host tells none, as
   * in a run no session started.
   */
  readonly projectDir: string | undefined;
  /**
   * How the host was started, in the host's own word, kept as told for a session's restore record; undefined when
   * it tells none.
   */
  readonly startedAs: string | undefined;
  /** The session's kind in the host's own word, kept as told for the same record; undefined when it tells none. */
  readonly sessionKind: string | undefined;
  /**
   * The host's own id of the session this run belongs to, which a tab's binding to a session of the team is kept
   * by; undefined when the host tells none, as in the person's own shell.
   */
  readonly sessionId: string | undefined;
  /**
   * The effort level the host's environment forces on every session it starts, over the one a session picked, in the
   * host's own word; undefined when nothing forces one, and the session's own effort holds.
   */
  readonly forcedEffort: string | undefined;
}

/**
 * The environment variables a host tells a run about its session by, each by its name. They are names and no
 * reading, as teamrig holds the variables of every host it ships with on a machine, whatever host runs the session.
 */
export interface SessionVariables {
  /**
   * The marks of an agent's run: each is set, to any value, in what the host's agent runs (its tools, what they run,
   * its hooks) and in nothing the person starts themselves. teamrig tells an agent's run from the person's own by
   * them, so a host names one at least.
   */
  readonly marks: readonly string[];
  /**
   * The other variables that say who the session is, such as its id and the folder it started in. A command line
   * that changes one of them, or a mark, would run a command as someone else, so the exec guard holds them all.
   */
  readonly identity: readonly string[];
}

/**
 * The environment variables a host sets for a session, by what a program teamrig starts may inherit of them. They
 * are names and no reading: teamrig filters the environment it hands a new session or a queued step by them.
 */
export interface ChildEnvironment {
  /**
   * Every variable the host sets for a session's own tools. A session or a step started from inside one must not
   * inherit them: it would look nested in its starter's session and could reach what the host keeps for that
   * session alone.
   */
  readonly session: readonly string[];
  /**
   * Those of `session` a step parked on disk keeps, so a `teamrig` it runs still resolves its parker's tab. What is
   * named here lands in a file, so none is a secret.
   */
  readonly parked: readonly string[];
  /** The host's own login. A session of the host keeps these; no other program teamrig starts gets them. */
  readonly login: readonly string[];
}

/** A running process as the system describes it, by what tells whose program it is. */
export interface RunningProgram {
  /** Its program's file name, such as `node` or a host's own binary. */
  readonly name: string;
  /** Its whole command line; empty when the system does not show it (a process of another user). */
  readonly commandLine: string;
}

/**
 * How a session of the host is to start, each part in teamrig's own terms: the host spells it its own way. A part
 * left undefined is the host's to pick.
 */
export interface SessionStart {
  /** The name the host shows the session under. */
  readonly name: string | undefined;
  /** The model the session runs on; undefined keeps the host's own default. */
  readonly model: string | undefined;
  /** The effort it works at; undefined keeps the host's own. */
  readonly effort: string | undefined;
  /** The host's id of an earlier session to go on in; undefined starts a new one. */
  readonly resume: string | undefined;
  /** A file of the host's settings to load over the person's own for this session; undefined loads none. */
  readonly settingsFile: string | undefined;
  /** The first prompt, sent as the session starts; undefined waits for the person. */
  readonly prompt: string | undefined;
}

export interface SessionLauncher {
  /**
   * The host program's name as people know it, such as `Claude Code`: what a commit stamp names. The core sees no
   * adapter's declaration, so the port carries the name itself. `program` is its file name.
   */
  readonly programName: string;
  /**
   * The file name of the host's own program as a shell finds it on PATH, with no folder and no extension. teamrig
   * looks for it there itself, the way it finds any program, and starts it with `launchArgs`.
   */
  readonly program: string;
  /**
   * The arguments that start the host's program in a session as `start` says, to follow the program itself. Each
   * is handed to the program as it is, through no shell.
   */
  launchArgs(start: SessionStart): readonly string[];
  /** The variables the host tells a run about its session by, the ones its declaration names. */
  readonly variables: SessionVariables;
  /** The variables the host sets for a session, by what a new session or a queued step may inherit of them. */
  readonly childEnv: ChildEnvironment;
  /** Who the host says this run is, in the environment the port was built for. */
  identity(): SessionIdentity;
  /**
   * Whether a running process is the host's own program running a session: its binary, or a runtime running its
   * script. teamrig tells by it that a recorded session still runs, and finds the session a hook or a step runs
   * under; a process id the system gave another program since must not pass.
   */
  isSessionProcess(process: RunningProgram): boolean;
  /**
   * Whether a process with `commandLine` is a fork of the host's session `session`: a new session the host starts
   * from that one's conversation (as Claude Code runs a /clear), outside its tab's process tree. teamrig takes such
   * a fork for the session itself, not a second run of it. An empty command line is none.
   */
  isForkOf(commandLine: string, session: string): boolean;
  /**
   * The host's id of the session a background job runs as, from the job's `lineage` (its process first, then the
   * processes that started it); undefined when no background run of the host started it, or it names no session.
   * teamrig tells by it the job a tab handed its conversation to, which may no longer be in the tab's tree.
   */
  backgroundJobSession(lineage: readonly RunningProgram[]): string | undefined;
  /**
   * Where a session ran, read from the host's own words for how it started, as `identity` told them and its restore
   * record kept them; undefined when they say nothing of it. The restore reopens only a `tab`.
   */
  sessionPlaceOf(told: Pick<SessionIdentity, 'startedAs' | 'sessionKind'>): SessionPlace | undefined;
  /**
   * How the host's own program hands a running session a prompt as its next turn, from outside the session's tab:
   * unsupported where the host has no such command, as Claude Code, whose tab's mod submits a wake itself.
   */
  readonly wake: SessionWake | Unsupported;
}

/**
 * A wake through the host's own program: teamrig finds `program` on PATH as for a start, runs it with `args`, through
 * no shell, and reads the run's end with `outcome`.
 */
export interface SessionWake {
  /**
   * The arguments, to follow the program, that hand the host's session `session` (the id `identity` told) the prompt
   * `text`. Each is handed to the program as it is.
   */
  args(session: string, text: string): readonly string[];
  /** What the run's end and output say came of the wake. */
  outcome(result: ProgramResult): WakeDelivery;
}

/**
 * What came of a wake: the host took the prompt (`delivered`), runs no session of that id to take it (`no-session`:
 * the session ended, so a wake waits for its next start), or failed, the reason in words a human reads.
 */
export type WakeDelivery =
  | { readonly kind: 'delivered' }
  | { readonly kind: 'no-session' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Where a session of the host ran: a terminal `tab` the person works in, a `background` job of the host, or
 * `elsewhere`, such as a run the host's SDK or its print mode started.
 */
export type SessionPlace = 'tab' | 'background' | 'elsewhere';
