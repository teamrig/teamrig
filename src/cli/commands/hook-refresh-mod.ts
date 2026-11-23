import { findTranscript } from '../../budget/discover.ts';
import { isNonNegativeInteger, type JsonRecord } from '../../core/guards.ts';
import { KIT_NAME } from '../../core/home.ts';
import { inBookedMeeting, MeetingSchedule } from '../../meeting/schedule.ts';
import { inMeeting, MeetingStore } from '../../meeting/state.ts';
import { decideCompact, decideMidTurn, handoverHashOf, type AskContext, type CompactDecision, type DueFacts } from '../../refresh/decide.ts';
import { readRunningWork } from '../../refresh/running.ts';
import { RefreshStore } from '../../refresh/store.ts';
import { sessionSettingsOf } from '../../refresh/window.ts';
import { readContextEstimate } from '../../refresh/usage.ts';
import { contextSourceIfTold, identityOf, transcriptsFolderIfKnown, transcriptsIfKept } from '../host.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { hookScopeOf, readHookInput, readModRequest, writeReply, type HookOrigin, type SessionScope } from './hook-input.ts';

/**
 * What `hook refresh-mid` answers the plugin's mod, one JSON line: the ask to add after the tool's result, or
 * none; with the context size to check again at (`nextAt`; null: only at the mod's recheck, as when refresh is off,
 * the tab is no team session, or its handover is marked ready and not yet announced).
 */
export type MidTurnAnswer =
  | { readonly kind: 'ask'; readonly text: string; readonly nextAt: number }
  | { readonly kind: 'wait'; readonly nextAt: number | null };

/**
 * What `hook compact-check` answers the plugin's mod, one JSON line: `go`, or `skip` with the line that says why. The
 * state a decision records (`CompactDecision.state`) is written here and never sent.
 */
export type CompactAnswer = { readonly kind: 'go' } | { readonly kind: 'skip'; readonly reason: string };

const OFF: MidTurnAnswer = { kind: 'wait', nextAt: null };
const GO: CompactAnswer = { kind: 'go' };

function answer(runtime: CliRuntime, value: MidTurnAnswer | CompactAnswer): ExitCode {
  runtime.out.stdout(JSON.stringify(value));
  return EXIT.ok;
}

function countOf(fields: JsonRecord, key: string): number | undefined {
  const value = fields[key];
  return isNonNegativeInteger(value) ? value : undefined;
}

/**
 * The facts a due refresh or notice reads: the handover as it is now (so a turn end or `refresh --ready` can tell
 * a new one from it, and the turn end can take a new one as ready), and the background work still running in
 * `transcript`, which a fresh start must wait for.
 */
export async function dueFactsAt(runtime: CliRuntime, store: RefreshStore, id: string, transcript: string | undefined): Promise<DueFacts> {
  const handover = await store.handover(id);
  // A host that keeps no transcript teamrig can read shows no running work, as a missing transcript shows none.
  const reader = transcriptsIfKept(runtime);
  return {
    handoverHash: handoverHashOf(handover),
    handover,
    running: transcript === undefined || reader === undefined ? 0 : await readRunningWork(reader, runtime.files, transcript, runtime.clock.now()),
  };
}

/**
 * Whether the session is in an open owner meeting, which holds its refresh (`meetingHolds`): the lead's daily meeting,
 * or a booked one it is met in or joins (`inBookedMeeting`, T2111). Two small files, the second read only when the
 * first holds nothing.
 */
export async function inMeetingNow(runtime: CliRuntime, scope: Pick<SessionScope, 'kit' | 'id'>): Promise<boolean> {
  const now = runtime.clock.now();
  if (inMeeting(await new MeetingStore(runtime.files, scope.kit.paths.meeting).read(), scope.id, now)) {
    return true;
  }
  return inBookedMeeting((await new MeetingSchedule(runtime.files, scope.kit.paths.meetings).read()).meetings, scope.id, now);
}

/** The tab's own transcript: the mod knows its Claude Code session and project, not where Claude Code keeps it. */
async function transcriptOf(runtime: CliRuntime, origin: HookOrigin): Promise<string | undefined> {
  if (origin.session === undefined) {
    return undefined;
  }
  const project = identityOf(runtime).projectDir ?? origin.cwd;
  return findTranscript(runtime.transcripts, transcriptsFolderIfKnown(runtime), project, origin.session);
}

/** What the ask names, the session's own limit capped by `window`, the context window last reported for it. */
function askContextOf(runtime: CliRuntime, scope: SessionScope, store: RefreshStore, window: number | undefined): AskContext {
  const { config, roster, id } = scope;
  return {
    settings: sessionSettingsOf(config, id, window),
    now: new Date(runtime.clock.now()).toISOString(),
    session: { id, team: scope.kit.paths.team, name: roster.nameOf(id) ?? id },
    handoverPath: store.handoverPath(id),
    command: KIT_NAME,
  };
}

/**
 * Run by the plugin's mod after a tool's result within a turn, once the context reached the size it was told to
 * check again at: asks the session to write its handover within this turn once its context reached the refresh
 * threshold (`decideMidTurn`), so a long turn refreshes before Claude Code compacts it. The ask is recorded
 * before it is answered, so the turn's end asks again only when the handover is not written by then. The
 * running work, which takes the transcript's last 8 MiB, is read only once the context is past the size.
 * stdin: `{session_id, cwd, tokens, window?}`, `tokens` the context the last reply read, `window` the context window
 * reported with it. The window is kept in the session's state file, since the turn end is never told it: a session's
 * own refresh limit is checked against it there too (#1543). A mod that sends none leaves the one kept.
 */
export async function refreshMid(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const request = await readModRequest(runtime);
  if (request === undefined) {
    return answer(runtime, OFF);
  }
  const { event, fields } = request;
  const tokens = countOf(fields, 'tokens');
  const scope = tokens === undefined ? undefined : await hookScopeOf(runtime, event);
  if (tokens === undefined || scope === undefined || !scope.config.refresh.enabled) {
    return answer(runtime, OFF);
  }
  const store = new RefreshStore(runtime.files, scope.kit.paths);
  const sent = countOf(fields, 'window');
  const kept = (await store.window(scope.id)).window;
  const window = sent !== undefined && sent > 0 ? sent : kept;
  if (window !== undefined && window !== kept) {
    await store.setWindow(scope.id, { window });
  }
  const state = await store.state(scope.id);
  const context = askContextOf(runtime, scope, store, window);
  const meeting = await inMeetingNow(runtime, scope);
  const first = decideMidTurn(state, context, { tokens, meeting, due: undefined });
  const decision =
    first.kind === 'measure'
      ? decideMidTurn(state, context, { tokens, meeting, due: await dueFactsAt(runtime, store, scope.id, await transcriptOf(runtime, event)) })
      : first;
  switch (decision.kind) {
    case 'ask':
      // Written before it is answered: an ask whose state is not recorded would be asked again at every tool.
      await store.setState(scope.id, decision.state);
      return answer(runtime, { kind: 'ask', text: decision.reason, nextAt: decision.nextAt });
    case 'none':
      if (decision.state !== undefined) {
        // A fresh start's first measure, its baseline.
        await store.setState(scope.id, decision.state);
      }
      return answer(runtime, { kind: 'wait', nextAt: decision.nextAt });
    case 'measure':
      // Asked only without the due facts, which the second decision has.
      return answer(runtime, OFF);
  }
}

/**
 * One automatic compaction's answer (`decideCompact`), on the session's state and its handover as they are now. A
 * compaction held back once for the refresh (T4119) records its ask for the handover before it is answered, so the
 * turn's end asks for it and a second compaction is not held back again.
 */
async function compactAnswerOf(
  runtime: CliRuntime,
  scope: SessionScope,
  facts: { readonly tokens: number; readonly window: number | undefined },
): Promise<CompactAnswer> {
  const store = new RefreshStore(runtime.files, scope.kit.paths);
  const context = { settings: scope.config.refresh, command: KIT_NAME, now: new Date(runtime.clock.now()).toISOString() };
  const handoverHash = handoverHashOf(await store.handover(scope.id));
  const decision: CompactDecision = decideCompact(await store.state(scope.id), context, { ...facts, handoverHash });
  if (decision.kind === 'go') {
    return GO;
  }
  if (decision.state !== undefined) {
    // Written before it is answered: a hold whose ask is not recorded would hold every compaction after it too.
    await store.setState(scope.id, decision.state);
  }
  return { kind: 'skip', reason: decision.reason };
}

/**
 * Run by the plugin's mod before Claude Code compacts the conversation, at its threshold or for the summary it
 * computes ahead: `skip`, with the line that says why, once per tab in favour of the refresh (T4119), and while the
 * session's handover is asked for or written and its fresh start follows this turn, so the compaction waits until
 * `refresh.compactCeilingTokens` (`decideCompact`, `compactAnswerOf`); else `go`, on any input it cannot read too.
 * stdin: `{session_id, cwd, tokens, window}`.
 */
export async function compactCheck(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const request = await readModRequest(runtime);
  if (request === undefined) {
    return answer(runtime, GO);
  }
  const { event, fields } = request;
  const tokens = countOf(fields, 'tokens');
  const window = countOf(fields, 'window');
  const scope = tokens === undefined || window === undefined ? undefined : await hookScopeOf(runtime, event);
  if (tokens === undefined || window === undefined || scope === undefined) {
    return answer(runtime, GO);
  }
  return answer(runtime, await compactAnswerOf(runtime, scope, { tokens, window }));
}

/**
 * Claude Code's classic PreCompact hook: `compactCheck`'s hold where the mod's never runs, on a host whose managed
 * mods seat one first that sends `session.compact` on past the user's mods (T2015). The same decision for a
 * compaction Claude Code runs on its own (trigger `auto`; a `/compact` the user typed goes), on the context
 * estimated from the transcript (`readContextEstimate`) and no window, which this hook is not told; a hold once for
 * the refresh records its ask the same way (`compactAnswerOf`). A hold answers `{decision: 'block', reason}`, a go
 * prints nothing, both with exit 0: exit 2 blocks a compaction too, so this hook never answers by a refusal. stdin:
 * `{session_id, transcript_path, cwd, trigger}`.
 */
export async function preCompact(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const { event } = await readHookInput(runtime);
  if (event === undefined || event.trigger !== 'auto') {
    return EXIT.ok;
  }
  const { transcript } = event;
  const scope = transcript === undefined ? undefined : await hookScopeOf(runtime, event);
  if (transcript === undefined || scope === undefined) {
    return EXIT.ok;
  }
  // No readable transcript or no meter, no estimate: the compaction goes, since a refusal here would block it.
  const source = contextSourceIfTold(runtime);
  const tokens = source === undefined ? undefined : await readContextEstimate(source, runtime.files, transcript);
  const decision = tokens === undefined ? GO : await compactAnswerOf(runtime, scope, { tokens, window: undefined });
  if (decision.kind === 'skip') {
    writeReply(runtime, 'compact-start', { verdict: { kind: 'block', reason: decision.reason } });
  }
  return EXIT.ok;
}
