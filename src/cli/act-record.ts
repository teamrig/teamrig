import { ACT_LOG_AGE, ActLog, type Act, type ActBy, type ActOutcome } from '../acts/act-log.ts';
import { DEFAULT_LOCK } from '../config/defaults.ts';
import { AgedLogFile } from '../core/aged-log.ts';
import { errorMessage } from '../core/guards.ts';
import { ENV } from '../core/home.ts';
import { SecretScanner } from '../core/secrets.ts';
import { runBy } from './agent-run.ts';
import { UsageError, type ParsedArgs } from './args.ts';
import { fileLockOf } from './file-locks.ts';
import { lookForTeam, openKit } from './kit.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode, type Output, type ProcessExit } from './runtime.ts';

/** What `runCli` prints before a refusal's reason (stdout) and a failure's (stderr). */
export const REFUSED_PREFIX = 'REFUSED ';
export const FAILED_PREFIX = 'FAILED ';

/** The note a run prints when its act could not be logged; the command's own exit code stands. */
export const ACT_NOT_LOGGED = 'NOTE the act log was not written:';

/** The run's channel as the act log keeps it: an untold run's notice is the host's, not the run's. */
function actByOf(runtime: CliRuntime): ActBy {
  const by = runBy(runtime);
  return by.kind === 'untold' ? { kind: 'untold' } : by;
}

/** The id of the shipped host the run works in; undefined for one teamrig does not ship (a spec's fake, a plugin's). */
function hostIdOf(runtime: CliRuntime): string | undefined {
  return Object.entries(runtime.shippedHosts).find(([, shipped]) => shipped.ports === runtime.host)?.[0];
}

/** `$TEAMRIG_SESSION`; an empty one names no session. */
function sessionOfEnv(runtime: CliRuntime): string | undefined {
  const set = runtime.env[ENV.session];
  return set === undefined || set === '' ? undefined : set;
}

/** A command may end with its child's own exit (redact-exec), so an exit teamrig does not name reads as failed. */
export function outcomeOf(exit: ProcessExit): ActOutcome {
  switch (exit) {
    case EXIT.ok:
      return 'ok';
    case EXIT.refused:
      return 'refused';
    case EXIT.usage:
      return 'usage';
    case EXIT.printed:
      return 'printed';
    case EXIT.ask:
      return 'ask';
    case EXIT.waiting:
      return 'waiting';
    default:
      return 'failed';
  }
}

/** The exit `runCli` gives a thrown error, so a thrown run is logged as it ends. */
function exitOfError(error: unknown): ExitCode {
  if (error instanceof UsageError) return EXIT.usage;
  if (error instanceof RefusedError) return EXIT.refused;
  return EXIT.failed;
}

/**
 * The first refusal or failure the command printed itself: most commands refuse by returning `EXIT.refused` after a
 * `REFUSED` line rather than by throwing, so the line is the only place their reason is.
 */
class ReasonWatch {
  reason: string | undefined;

  wrap(out: Output): Output {
    return {
      ...out,
      stdout: (line) => {
        this.take(line, REFUSED_PREFIX);
        out.stdout(line);
      },
      stderr: (line) => {
        this.take(line, FAILED_PREFIX);
        out.stderr(line);
      },
    };
  }

  private take(line: string, prefix: string): void {
    if (this.reason === undefined && line.startsWith(prefix)) {
      this.reason = line.slice(prefix.length);
    }
  }
}

/** The team the run acts for: `--team`, else the one its folder or `$TEAMRIG_TEAM` names; undefined for none. */
async function teamOf(args: ParsedArgs, runtime: CliRuntime): Promise<string | undefined> {
  const flag = args.flags.get('team') ?? args.common.get('team');
  if (flag !== undefined) return flag;
  const found = await lookForTeam(runtime);
  return found.kind === 'team' ? found.team : undefined;
}

/**
 * Appends the act to its team's log. A run for no team, or for one with no config yet, is logged nowhere: there is
 * no team folder to keep it, and writing one would leave a husk of a team that does not exist.
 */
async function logAct(act: Act, args: ParsedArgs, runtime: CliRuntime): Promise<void> {
  const team = await teamOf(args, runtime);
  if (team === undefined) return;
  const { load, paths } = await openKit(runtime, team);
  if (load.status === 'missing') return;
  const { files, clock } = runtime;
  // Default lock timings, as the hook logs: every writer of one lock must agree on when it is stale, config or none.
  const log = new AgedLogFile({ files, clock, mutex: fileLockOf(runtime, paths.actsLock, DEFAULT_LOCK) }, { live: paths.acts, archive: paths.archive, name: 'acts' }, ACT_LOG_AGE);
  const scanner = new SecretScanner(load.status === 'loaded' ? load.config.register.secretPatterns : []);
  await new ActLog(log, scanner).append(act);
}

/**
 * Runs a write command and logs it as an act (src/acts/act-log.ts): who ran it, through which channel, what, and how
 * it ended, refusals and failures too. A thrown error is logged, then thrown on for `runCli` to print. The log's own
 * failure never changes the run's exit: it prints a note and the exit stands.
 */
export async function recordedRun(argv: readonly string[], args: ParsedArgs, runtime: CliRuntime, run: (watched: CliRuntime) => Promise<ProcessExit>): Promise<ProcessExit> {
  const started = runtime.clock.now();
  const watch = new ReasonWatch();
  const watched: CliRuntime = { ...runtime, out: watch.wrap(runtime.out) };
  const record = async (exit: ProcessExit, reason: string | undefined): Promise<void> => {
    const act: Act = {
      at: new Date(started),
      ms: Math.max(0, runtime.clock.now() - started),
      session: args.flags.get('session') ?? args.common.get('session') ?? sessionOfEnv(runtime),
      by: actByOf(runtime),
      host: hostIdOf(runtime),
      command: args.command,
      argv,
      outcome: outcomeOf(exit),
      exit,
      reason: exit === EXIT.ok ? undefined : reason,
    };
    try {
      await logAct(act, args, runtime);
    } catch (error) {
      runtime.out.stderr(`${ACT_NOT_LOGGED} ${errorMessage(error)}`);
    }
  };
  let exit: ProcessExit;
  try {
    exit = await run(watched);
  } catch (error) {
    await record(exitOfError(error), errorMessage(error));
    throw error;
  }
  await record(exit, watch.reason);
  return exit;
}
