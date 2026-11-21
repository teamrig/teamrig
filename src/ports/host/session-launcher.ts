/**
 * The host's sessions as the core starts, finds and names them. So far the port tells the program's name and who the
 * host says a run is; a launch, a resume, a session's processes and a wake join it as each moves out of the core.
 */

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

export interface SessionLauncher {
  /**
   * The host program's name as people know it, such as `Claude Code`: what a commit stamp names. The core sees no
   * adapter's declaration, so the port carries the name itself.
   */
  readonly programName: string;
  /** The variables the host tells a run about its session by, the ones its declaration names. */
  readonly variables: SessionVariables;
  /** The variables the host sets for a session, by what a new session or a queued step may inherit of them. */
  readonly childEnv: ChildEnvironment;
  /** Who the host says this run is, in the environment the port was built for. */
  identity(): SessionIdentity;
}
