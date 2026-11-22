import type { LaunchConfig } from '../config/types.ts';
import type { Files } from '../core/files.ts';
import type { HostModels, TranscriptReader } from '../ports/host/index.ts';
import { modelCheckLine } from './model-check.ts';
import { fallbackLine, readLastFallback } from './model-fallback.ts';
import type { ModelNoticeStore } from './model-notices.ts';

/** What the Stop hook knows of a team session at the end of a turn. */
export interface StopModelInput {
  /** The team session's id, which names its notice file. */
  readonly id: string;
  /** Its name, as the notices show it. */
  readonly name: string;
  /** Its `launch` entry, with the lead's defaults filled in. */
  readonly launch: LaunchConfig;
  /** The host's session id: each notice shows once per host session. */
  readonly hostSession: string;
  /** The payload's effort level; undefined when it gives none. */
  readonly effort: string | undefined;
  /** The payload's transcript path; undefined when it gives none. */
  readonly transcript: string | undefined;
}

interface Notice {
  readonly key: string;
  readonly line: string;
}

function effortNotice(models: HostModels, input: StopModelInput): Notice | undefined {
  const line = modelCheckLine(models, input.name, input.launch, { model: undefined, effort: input.effort });
  return line === undefined ? undefined : { key: `effort:${input.effort ?? ''}`, line };
}

async function fallbackNotice(reader: TranscriptReader | undefined, models: HostModels, files: Files, input: StopModelInput): Promise<Notice | undefined> {
  const fallback = reader === undefined || input.transcript === undefined ? undefined : await readLastFallback(reader, files, input.transcript);
  return fallback === undefined ? undefined : { key: `fallback:${fallback.id}`, line: fallbackLine(models, input.name, fallback, input.launch.model) };
}

function isNotice(notice: Notice | undefined): notice is Notice {
  return notice !== undefined;
}

/**
 * The lines the Stop hook shows the user about the session's model: that it runs at another effort
 * than its `launch` entry (SessionStart has no effort level it can trust), and that the host
 * switched its model after a safeguard stop. Each shows once per host session, recorded before
 * it is returned, so a store that cannot be written shows nothing rather than the same line at every stop.
 * With no `reader` (the host keeps no transcript teamrig can read) no switch is known: only the effort shows. With
 * no `models` (the host knows no model names or switch steps) nothing shows: a line would name no step to take.
 */
export async function stopModelNotices(
  reader: TranscriptReader | undefined,
  models: HostModels | undefined,
  files: Files,
  store: ModelNoticeStore,
  input: StopModelInput,
): Promise<readonly string[]> {
  if (models === undefined) {
    return [];
  }
  const found = [effortNotice(models, input), await fallbackNotice(reader, models, files, input)].filter(isNotice);
  if (found.length === 0) {
    return [];
  }
  const told = await store.told(input.id, input.hostSession);
  const fresh = found.filter((notice) => !told.includes(notice.key));
  if (fresh.length > 0) {
    await store.remember(
      input.id,
      input.hostSession,
      fresh.map((notice) => notice.key),
    );
  }
  return fresh.map((notice) => notice.line);
}
