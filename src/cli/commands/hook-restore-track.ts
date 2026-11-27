import { join } from 'node:path';
import { ENV, resolveKitHome } from '../../core/home.ts';
import { ID_PATTERN } from '../../core/ids.ts';
import { KIT_VERSION } from '../../core/version.ts';
import { clientRootOf } from '../../exec/client-integrity.ts';
import { INBOX_ADD_LAUNCHER_SCRIPT, inboxAddLauncherPath } from '../../inbox/host-launcher.ts';
import { installRunningKit, KIT_INSTALL_LOCK, kitInstallLockPath, kitSelfInstallLogLine, kitSelfInstallNote } from '../../kit/kit-self-install.ts';
import type { HookEvent } from '../../ports/host/index.ts';
import { dayProbePath, dayProbeReleaseLine, type DayProbeReply } from '../../restore/day-probe.ts';
import { DayProbeStore } from '../../restore/day-probe-store.ts';
import { apiGaveUpLine, apiRetriesSpentOn } from '../../restore/api-error.ts';
import { KIT_LAUNCHER_FILE } from '../../restore/cli-launcher.ts';
import { cliOnPathNote, cliOnPathSteps } from '../../restore/cli-on-path.ts';
import { applyEvent, type TrackEvent, type TrackFacts } from '../../restore/entry.ts';
import { LAUNCHER_REFRESH_LOCK, launcherRecordPath, refreshLaunchers } from '../../restore/launcher-refresh.ts';
import { AUTH_FAILED, LOGIN_LOCK, loginLogLine, loginMarkerPath, type LoginEvent } from '../../restore/login.ts';
import { LoginStore } from '../../restore/login-store.ts';
import { RestoreRegistry, restoreLogPath, restoreSessionsDir } from '../../restore/registry.ts';
import { TURN_TAIL_BYTES, turnErrorOf } from '../../restore/turn-error.ts';
import type { UserPath } from '../../restore/user-path.ts';
import { LAUNCHER_SCRIPT, launcherPath } from '../../statusline/launcher.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { fileLockOf } from '../file-locks.ts';
import { openKit } from '../kit.ts';
import { DEFAULT_HOST } from '../../composition/adapters.ts';
import { hostIdOf, identityOf, transcriptsIfKept } from '../host.ts';
import { loginPageLogLine, loginPageOf, sendLoginPage, type LoginPage } from '../login-page.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { hookScopeOf, readHookInput, writeReply, type HookOrigin } from './hook-input.ts';

/**
 * What a hook event reports to the tracker; undefined for one the tracker skips. A session start that follows a
 * compaction (`source: compact`) is skipped: it comes mid-turn in the same process, and must not mark a working
 * session ready.
 */
export function trackEventOf(event: Pick<HookEvent, 'name' | 'source' | 'helper' | 'error' | 'reason'>): TrackEvent | undefined {
  switch (event.name) {
    case 'session-start':
      return event.source === 'compact' ? undefined : { kind: 'start' };
    case 'prompt':
      return { kind: 'working' };
    case 'tool-end':
    case 'tool-failed':
      // A helper's tool call carries the helper's id.
      return { kind: 'tool', mainThread: event.helper?.id === undefined };
    case 'stop':
      return { kind: 'ready' };
    case 'stop-failed':
      // An event with no error is read from the transcript once, by `trackRestore` (`codedEvent`).
      return { kind: 'error', code: event.error };
    case 'session-end':
      return { kind: 'end', reason: event.reason };
    default:
      return undefined;
  }
}

/** A non-empty value; undefined for an unset or blank one. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** A team or session id from the environment; undefined unless it is one, so no other text reaches a command line. */
function envId(runtime: CliRuntime, name: string): string | undefined {
  const value = present(runtime.env[name]);
  return value !== undefined && ID_PATTERN.test(value) ? value : undefined;
}

type TeamSession = Pick<TrackFacts, 'team' | 'session'>;

/** Finds a hand-opened tab's team and session; called at most once per event, and only where one is needed. */
type TeamLookup = () => Promise<TeamSession>;

/**
 * For a tab a person opened by hand, the team and session the tab title hook finds for it (its project's team, and
 * the session that read its inbox from this tab), so its log lines name it and its login failure pages its team
 * (#820); neither is set unless both are found. Only the page and the labels use them: the entry keeps the tab's own
 * `$TEAMRIG_TEAM`/`$TEAMRIG_SESSION`, as a restore reopens an entry naming both through `teamrig launch`. It reads
 * the team's files, so it runs once at most, and only when a log line or a login page needs the tab's team.
 */
function teamLookupOf(runtime: CliRuntime, origin: HookOrigin): TeamLookup {
  let found: Promise<TeamSession> | undefined;
  return () => {
    found ??= hookScopeOf(runtime, origin)
      .catch(() => undefined)
      .then((scope) => (scope === undefined ? { team: undefined, session: undefined } : { team: scope.kit.paths.team, session: scope.id }));
    return found;
  };
}

/** The facts with the found team and session when `$TEAMRIG_TEAM` named none: a launched tab's environment wins. */
async function namedFacts(facts: TrackFacts, lookup: TeamLookup): Promise<TrackFacts> {
  return facts.team !== undefined ? facts : { ...facts, ...(await lookup()) };
}

/**
 * Writes the event into its session's restore entry, or removes the entry at an end the person chose. A turn that
 * failed on a transient API error with every retry spent (src/restore/api-error.ts) is logged as left for the person,
 * named by the lookup's team and session when its environment names none.
 */
async function trackEntry(event: TrackEvent, facts: TrackFacts, lookup: TeamLookup, runtime: CliRuntime, kitHome: string): Promise<void> {
  const registry = new RestoreRegistry(runtime.files, restoreSessionsDir(kitHome));
  const change = applyEvent(await registry.read(facts.hostSession), event, facts);
  switch (change.kind) {
    case 'write': {
      await registry.write(change.entry);
      const spentOn = event.kind === 'error' ? apiRetriesSpentOn(change.entry) : undefined;
      if (spentOn !== undefined) {
        const label = tabLabelOf(await namedFacts(facts, lookup));
        await runtime.files.append(restoreLogPath(kitHome), `${new Date(facts.at).toISOString()} ${apiGaveUpLine(label, spentOn)}\n`);
      }
      return;
    }
    case 'remove':
      await registry.remove(facts.hostSession);
      return;
    case 'none':
      return;
  }
}

/**
 * The event with a failed turn's error read from the transcript when the hook event named none
 * (src/restore/turn-error.ts); a transcript that cannot be read names none, and never keeps the entry from its update.
 */
async function codedEvent(event: TrackEvent, facts: TrackFacts, runtime: CliRuntime): Promise<TrackEvent> {
  const { transcriptPath } = facts;
  if (event.kind !== 'error' || event.code !== undefined) {
    return event;
  }
  const tailOf = async (): Promise<string | undefined> => (transcriptPath === undefined ? undefined : runtime.files.readTail(transcriptPath, TURN_TAIL_BYTES));
  return { kind: 'error', code: await turnErrorOf(transcriptsIfKept(runtime), event.code, tailOf).catch(() => undefined) };
}

/** The login event a turn end reports: a good one answered, a failed one failed on the login; undefined for any other. */
function loginEventOf(event: TrackEvent, facts: TrackFacts): LoginEvent | undefined {
  const { hostSession, at } = facts;
  switch (event.kind) {
    case 'ready':
      return { kind: 'answered', hostSession, at };
    case 'error':
      return event.code === AUTH_FAILED ? { kind: 'auth-failed', hostSession, at } : undefined;
    default:
      return undefined;
  }
}

/** How the restore log names a tab: its team and session when they are known, and its Claude session. */
function tabLabelOf(facts: TrackFacts): string {
  return facts.team === undefined || facts.session === undefined ? facts.hostSession : `${facts.team}/${facts.session} (${facts.hostSession})`;
}

/**
 * The page a failure of this tab would send: only a tab of a team, whose config or a team's above it names a page
 * webhook. A config that cannot be read pages no one and keeps the marker from no update.
 */
async function pageOf(event: LoginEvent, facts: TrackFacts, runtime: CliRuntime): Promise<LoginPage | undefined> {
  if (event.kind !== 'auth-failed' || facts.team === undefined) {
    return undefined;
  }
  return loginPageOf(runtime, facts.team, facts.session, event.at).catch(() => undefined);
}

/**
 * Follows the login through turn ends (src/restore/login.ts); each change with a note goes to the restore log. The
 * failure that claims an expiry's page posts it to the owner outside the marker's lock, a slow chat holding no other
 * tab, and gives the claim back when the post fails, so the next failure pages.
 */
async function trackLogin(event: TrackEvent, facts: TrackFacts, lookup: TeamLookup, runtime: CliRuntime, kitHome: string): Promise<void> {
  const loginEvent = loginEventOf(event, facts);
  if (loginEvent === undefined) {
    return;
  }
  const page = loginEvent.kind === 'auth-failed' ? await pageOf(loginEvent, await namedFacts(facts, lookup), runtime) : undefined;
  const path = loginMarkerPath(kitHome);
  const store = new LoginStore(runtime.files, path, fileLockOf(runtime, `${path}.lock`, LOGIN_LOCK));
  const { change, pageClaimed } = await store.apply(loginEvent, { claimPage: page !== undefined });
  const log = restoreLogPath(kitHome);
  if (change.kind === 'write' && change.note !== undefined) {
    const line = loginLogLine(change.note, tabLabelOf(await namedFacts(facts, lookup)), change.marker);
    await runtime.files.append(log, `${new Date(facts.at).toISOString()} ${line}\n`);
  }
  if (!pageClaimed || page === undefined) {
    return;
  }
  const problem = await sendLoginPage(page, runtime);
  await runtime.files.append(log, `${new Date(runtime.clock.now()).toISOString()} ${loginPageLogLine(page, problem)}\n`);
  if (problem !== undefined) {
    await store.releasePage(loginEvent.at);
  }
}

/** The reply an event shows the login works by: a good turn end, or a tool end of the tab's own turn; undefined for any other. */
function dayProbeReplyOf(event: TrackEvent, facts: TrackFacts): DayProbeReply | undefined {
  if (event.kind === 'ready') {
    return { kind: 'answered', tab: facts.hostSession, at: facts.at };
  }
  return event.kind === 'tool' && event.mainThread ? { kind: 'tool', tab: facts.hostSession, at: facts.at } : undefined;
}

/** Releases the day-start probe (src/restore/day-probe.ts) at a reply that shows the login works, and logs it. */
async function trackDayProbe(event: TrackEvent, facts: TrackFacts, lookup: TeamLookup, runtime: CliRuntime, kitHome: string): Promise<void> {
  const reply = dayProbeReplyOf(event, facts);
  if (reply === undefined) {
    return;
  }
  const path = dayProbePath(kitHome);
  const released = await new DayProbeStore(runtime.files, path, fileLockOf(runtime, `${path}.lock`, LOGIN_LOCK)).release(reply);
  if (released !== undefined) {
    const label = tabLabelOf(await namedFacts(facts, lookup));
    await runtime.files.append(restoreLogPath(kitHome), `${new Date(facts.at).toISOString()} ${dayProbeReleaseLine(label, reply, released)}\n`);
  }
}

/**
 * Whether a session start of `team` puts teamrig on the user's PATH [cliOnPath.enabled]: always for a session of no
 * team; for a team's, unless its config turns it off or cannot be read, so a broken config writes nothing a user
 * may have turned off.
 */
async function putsCliOnPath(runtime: CliRuntime, team: string | undefined): Promise<boolean> {
  if (team === undefined) {
    return true;
  }
  const { load } = await openKit(runtime, team);
  return load.status === 'loaded' && load.config.cliOnPath.enabled;
}

/** `userPath`, keeping in `added` each folder its `add` put on the PATH. */
function addRecorded(userPath: UserPath, added: string[]): UserPath {
  return {
    where: userPath.where,
    holds: (folder) => userPath.holds(folder),
    add: async (folder) => {
      await userPath.add(folder);
      added.push(folder);
    },
  };
}

/**
 * At a session start, brings what a restore install and the status line install left on the machine up to date with
 * this plugin version (src/restore/launcher-refresh.ts): the logon entry and the shortcuts are run by this hook's Node,
 * the stable program Claude Code starts its hooks with. Returns the note saying this start put teamrig on the user's
 * PATH, only on the start that did: a later one finds the folder there and adds nothing.
 */
async function trackLaunchers(event: TrackEvent, facts: TrackFacts, runtime: CliRuntime, kitHome: string): Promise<string | undefined> {
  if (event.kind !== 'start') {
    return undefined;
  }
  const { files, restore, platform } = runtime;
  const added: string[] = [];
  const userPath = addRecorded(restore.userPath, added);
  // A client with no built kit launcher (a run from the source tree) puts nothing on the PATH: the PATH must never
  // name a folder whose `teamrig.mjs` is missing, or an older one this client did not ship.
  const launcherText = await files.read(join(clientRootOf(runtime.self.script), KIT_LAUNCHER_FILE)).catch(() => undefined);
  const cliOnPath =
    launcherText !== undefined && (await putsCliOnPath(runtime, facts.team))
      ? [() => cliOnPathSteps({ files, kitHome, launcherText, platform, userPath, markExecutable: restore.markExecutable })]
      : [];
  await refreshLaunchers({
    machine: { files, kitHome, node: runtime.self.node, userHome: runtime.userHome, logon: restore.logon, shortcuts: restore.shortcuts },
    others: [
      { path: launcherPath(kitHome), text: LAUNCHER_SCRIPT },
      { path: inboxAddLauncherPath(kitHome), text: INBOX_ADD_LAUNCHER_SCRIPT, create: true },
    ],
    parts: cliOnPath,
    lock: fileLockOf(runtime, `${launcherRecordPath(kitHome)}.lock`, LAUNCHER_REFRESH_LOCK),
    version: KIT_VERSION,
    now: runtime.clock.now(),
  });
  const folder = added[0];
  return folder === undefined ? undefined : cliOnPathNote(folder, userPath.where);
}

/**
 * At a session start, copies the running client into the kit home's `versions/` and names it current
 * (src/kit/kit-self-install.ts), logging a change or refusal to the restore log. Returns the note of a pinned install,
 * which names the pin at every start.
 */
async function trackKitVersion(event: TrackEvent, runtime: CliRuntime, kitHome: string): Promise<string | undefined> {
  if (event.kind !== 'start') {
    return undefined;
  }
  const outcome = await installRunningKit({
    files: runtime.files,
    tree: runtime.kitTree,
    kitHome,
    clientRoot: clientRootOf(runtime.self.script),
    version: KIT_VERSION,
    source: { kind: 'claude-code-plugin' },
    lock: fileLockOf(runtime, kitInstallLockPath(kitHome), KIT_INSTALL_LOCK),
  });
  const line = kitSelfInstallLogLine(outcome);
  if (line !== undefined) {
    await runtime.files.append(restoreLogPath(kitHome), `${new Date(runtime.clock.now()).toISOString()} ${line}\n`);
  }
  return kitSelfInstallNote(outcome);
}

/** The start's notes joined one per line; undefined when it has none. */
function joinedNotes(notes: readonly (string | undefined)[]): string | undefined {
  const present = notes.filter((note): note is string => note !== undefined);
  return present.length === 0 ? undefined : present.join('\n');
}

/**
 * Records what the hook event `hook` reports in its session's restore entry, at a turn's end in the login marker, at
 * a reply in the day-start probe, and at a session start refreshes the launchers and installs the running client into
 * the kit home; an event of no session, or one it skips, writes nothing. A marker, probe, refresh or install that
 * cannot be written (its lock busy) never keeps the entry from its update; an entry that cannot be written fails the
 * call once they are done. Returns the notes of a start that put teamrig on the user's PATH (`trackLaunchers`) or found
 * the install pinned (`trackKitVersion`), else undefined.
 */
export async function trackRestore(hook: HookEvent, runtime: CliRuntime): Promise<string | undefined> {
  const hostSession = hook.session;
  const reported = trackEventOf(hook);
  if (hostSession === undefined || reported === undefined) {
    return undefined;
  }
  const told = identityOf(runtime);
  const host = hostIdOf(runtime);
  const facts: TrackFacts = {
    hostSession,
    at: runtime.clock.now(),
    // The folder the session started in, which stays put through a `cd` or a worktree: the one to resume from.
    projectDir: told.projectDir ?? present(hook.cwd),
    transcriptPath: present(hook.transcript),
    entrypoint: told.startedAs,
    sessionKind: told.sessionKind,
    // Claude Code starts its hooks itself (exec form, no shell), so the hook's parent is the session's Claude Code.
    pid: runtime.sessionProcesses.parentPid,
    team: envId(runtime, ENV.team),
    session: envId(runtime, ENV.session),
    // So a restore reopens it in the host it ran in; the default host is left out, as in the session's record.
    ...(host === DEFAULT_HOST ? {} : { host }),
  };
  const lookup = teamLookupOf(runtime, hook);
  const kitHome = resolveKitHome(runtime.env, runtime.userHome);
  const event = await codedEvent(reported, facts, runtime);
  const login = trackLogin(event, facts, lookup, runtime, kitHome).catch(() => undefined);
  const dayProbe = trackDayProbe(event, facts, lookup, runtime, kitHome).catch(() => undefined);
  const launchers = trackLaunchers(event, facts, runtime, kitHome).catch(() => undefined);
  const kit = trackKitVersion(event, runtime, kitHome).catch(() => undefined);
  try {
    await trackEntry(event, facts, lookup, runtime, kitHome);
  } finally {
    await Promise.all([login, dayProbe, launchers, kit]);
  }
  return joinedNotes([await launchers, await kit]);
}

/**
 * SessionStart, UserPromptSubmit, Stop, StopFailure and SessionEnd: records the session in the restore
 * registry (`<kit home>/restore/sessions`), in a team or not, so the restore after a reboot knows which tabs
 * it closed and what each was doing (a tool's end comes through `hook tool-end`). At a turn's end it also follows the
 * login (`<kit home>/restore/login.json`): which tabs a turn that ended on Login expired left stuck, and when a
 * good turn showed the login works again; the first failure of an expiry pages the owner through the webhook the
 * team's `alerts.pageWebhookFile` or `alerts.pageWebhookEnv` names. A good turn end also releases the day-start probe
 * (`<kit home>/restore/day-probe.json`), as does the probe tab's tool end. A turn that failed on a transient API error
 * after the wake check's last retry logs `api-error: gave up on <tab>` to the restore log. The first session start of a
 * newer plugin version rewrites the launchers, logon entry and shortcuts an install left that are out of date, and
 * logs each change as `launchers: <old> -> <new>: <change>` (src/restore/launcher-refresh.ts). A session start also
 * copies the running plugin into `<kit home>/versions/<v>` and names it current unless `teamrig kit use` pinned another,
 * logging `kit: ...` (src/kit/kit-self-install.ts). It prints nothing but the note of the start that put teamrig on the
 * user's PATH or found the install pinned, to the person and the model, and on any error it exits 0
 * having written nothing: a tracker must never hold up a turn.
 */
export async function restoreTrack(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const { event } = await readHookInput(runtime);
  if (event !== undefined) {
    const note = await trackRestore(event, runtime).catch(() => undefined);
    if (note !== undefined) {
      // Only a start returns a note (`trackLaunchers`, `trackKitVersion`).
      writeReply(runtime, 'session-start', { context: note, notice: note });
    }
  }
  return EXIT.ok;
}
