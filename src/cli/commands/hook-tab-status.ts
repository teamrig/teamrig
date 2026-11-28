import type { KitConfig } from '../../config/types.ts';
import { tabDisplayOf, type TeamRoster } from '../../hooks/bind.ts';
import { TRANSCRIPT_TAIL_BYTES } from '../../names/title.ts';
import type { HookEvent } from '../../ports/host/index.ts';
import { readRunningKinds } from '../../refresh/running.ts';
import type { TitleHold } from '../../setup/tab-status-note.ts';
import { IdleCompactionStore, onEmptyPrompt } from '../../tabs/idle-compaction.ts';
import { TabNeedStore } from '../../tabs/need.ts';
import { helpersRun, readyWaitsOnHelpers, tabChangeOf, tabTitle, topicOf, type TranscriptTail } from '../../tabs/status.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { hooksIfRun, launcherIfTold, transcriptsIfKept } from '../host.ts';
import { openKit, rosterOf } from '../kit.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { hookScopeOf, readHookInput, sessionTeam, writeReply } from './hook-input.ts';
import { pickerRefusal } from './hook-picker-guard.ts';
import { recordTabNeed } from './hook-tab-need.ts';

type HostOfRun = Pick<CliRuntime, 'host' | 'env' | 'platform'>;

/**
 * Who holds the run's tab title, as its host's hook port tells: the hooks when the host's title switch is on or it
 * names none (it writes no title of its own), else the host until that switch is set. Named by the host's program
 * where its launcher tells one.
 */
export function titleHoldOf(runtime: HostOfRun): TitleHold {
  const hooks = hooksIfRun(runtime);
  if (hooks === undefined) {
    return { kind: 'no-hooks' };
  }
  const { titleSwitch } = hooks;
  if (titleSwitch === undefined || titleSwitch.on(runtime.env)) {
    return { kind: 'hooks' };
  }
  return { kind: 'host', hostName: launcherIfTold(runtime)?.programName ?? 'the host', variable: titleSwitch.variable, value: titleSwitch.value };
}

/** Whether the host leaves the tab title to hooks: otherwise it writes its own over the circle. */
export function titleLeftToHooks(runtime: HostOfRun): boolean {
  return titleHoldOf(runtime).kind === 'hooks';
}

/** Whether a team's hooks show tab status: `tabStatus.enabled` in its config, and the host leaves them the title. */
export function tabStatusOn(runtime: HostOfRun, config: KitConfig): boolean {
  return config.tabStatus.enabled && titleLeftToHooks(runtime);
}

/** The end of the session's transcript the topic reads; undefined without one. */
async function transcriptTailOf(runtime: CliRuntime, transcript: string | undefined): Promise<TranscriptTail | undefined> {
  const text = transcript === undefined || transcript === '' ? undefined : await runtime.files.readTail(transcript, TRANSCRIPT_TAIL_BYTES);
  return text === undefined ? undefined : { text, whole: Buffer.byteLength(text, 'utf8') < TRANSCRIPT_TAIL_BYTES };
}

/** Whether a helper the session started still runs, by its transcript; none on a host that keeps no transcript teamrig can read. */
async function helpersRunFor(runtime: CliRuntime, transcript: string | undefined): Promise<boolean> {
  const reader = transcriptsIfKept(runtime);
  return transcript !== undefined && transcript !== '' && reader !== undefined && helpersRun(await readRunningKinds(reader, runtime.files, transcript, runtime.clock.now()));
}

/** What a tab title reads beside its hook event: a refresh notice's title, and whether a compaction began idle. */
export interface TabTitleOptions {
  /** The title after the circle in place of the session's topic: a refresh notice's. */
  readonly label?: string | undefined;
  /** The compaction this event ends started on an empty prompt (`tabChangeOf`). */
  readonly idle?: boolean;
}

/**
 * The title this hook event gives the tab: its state's circle before `label` (a refresh notice's title), else
 * before the session's topic, read from the transcript only when the event has no session title; a topic
 * naming one session of `own` reads `[<team>] <name>` (tabDisplayOf). A ready state reads as working while a
 * helper still runs. '' gives the title back to the terminal; undefined leaves it. On a host that keeps no
 * transcript teamrig can read, the topic comes from the event alone.
 */
export async function tabTitleOf(runtime: CliRuntime, event: HookEvent, own: TeamRoster, { label, idle = false }: TabTitleOptions = {}): Promise<string | undefined> {
  const change = tabChangeOf(event, idle);
  if (change === undefined || change === 'reset') {
    return change === 'reset' ? '' : undefined;
  }
  const state = readyWaitsOnHelpers(event, change) && (await helpersRunFor(runtime, event.transcript)) ? 'working' : change;
  if (label !== undefined) {
    return tabTitle(state, label);
  }
  const reader = transcriptsIfKept(runtime);
  const tail = reader !== undefined && event.title === undefined ? await transcriptTailOf(runtime, event.transcript) : undefined;
  return tabTitle(state, tabDisplayOf(own, topicOf(reader, event, tail)));
}

/**
 * The tab title this hook event sets; undefined with tab status off or no change. A question picker the picker
 * guard refuses leaves the title: the picker never opens, and the session goes on.
 */
export async function tabStatusTitleOf(runtime: CliRuntime, event: HookEvent, idle = false): Promise<string | undefined> {
  // The switch first: it costs no file read, and on most machines it is off.
  if (!titleLeftToHooks(runtime)) {
    return undefined;
  }
  const found = await sessionTeam(event.cwd, runtime);
  const kit = found.kind === 'team' ? await openKit(runtime, found.team) : undefined;
  if (kit?.load.status !== 'loaded' || !kit.load.config.tabStatus.enabled) {
    return undefined;
  }
  if ((await pickerRefusal(runtime, kit, kit.load.config, event)) !== undefined) {
    return undefined;
  }
  return tabTitleOf(runtime, event, { team: kit.paths.team, roster: await rosterOf(runtime, kit, kit.load.config) }, { idle });
}

/**
 * Whether the compaction this event ends started on an empty prompt (#1065). A compaction's start notes it when the
 * session's tab file (src/tabs/need.ts) shows a state on an empty prompt, read before this event rewrites the file;
 * its end takes the note, and the session's end removes one left. False for every other event, and for a tab that is
 * no team session, which has no tab file: its compaction ends working, as before.
 */
export async function idleCompactionOf(runtime: CliRuntime, event: HookEvent): Promise<boolean> {
  if (event.name !== 'compact-start' && event.name !== 'compact-end' && event.name !== 'session-end') {
    return false;
  }
  const scope = await hookScopeOf(runtime, event);
  if (scope === undefined) {
    return false;
  }
  const notes = new IdleCompactionStore(runtime.files, scope.kit.paths);
  if (event.name === 'compact-end') {
    return notes.take(scope.id);
  }
  const tab = event.name === 'compact-start' ? await new TabNeedStore(runtime.files, scope.kit.paths).read(scope.id) : undefined;
  if (tab !== undefined && onEmptyPrompt(tab.state)) {
    await notes.note(scope.id, new Date(runtime.clock.now()).toISOString());
  } else {
    // A compaction inside a turn, or the session's end: no note stays from an earlier one that never ended.
    await notes.remove(scope.id);
  }
  return false;
}

/**
 * Every hook event but Stop (whose hook writes the title with its own output): with `tabStatus.enabled` and
 * the host's own title off, sets the tab's title to a circle for what the session is doing (tabs/status.ts)
 * before its topic. Outside a team, with either off, for input that is not a hook payload or on any error, it
 * prints nothing. Either way it records a team session's tab in its tab file (hook-tab-need.ts), after a
 * compaction's start has read that file for what the tab showed (`idleCompactionOf`).
 */
export async function tabStatus(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const { event } = await readHookInput(runtime);
  if (event === undefined) {
    return EXIT.ok;
  }
  const idle = await idleCompactionOf(runtime, event).catch(() => false);
  const [tabTitle] = await Promise.all([
    tabStatusTitleOf(runtime, event, idle).catch((): string | undefined => undefined),
    recordTabNeed(runtime, event, undefined, idle).catch(() => undefined),
  ]);
  // An event teamrig has no name for changes no tab, so it has no title to write.
  if (event.name !== 'other') {
    writeReply(runtime, event.name, { tabTitle });
  }
  return EXIT.ok;
}
