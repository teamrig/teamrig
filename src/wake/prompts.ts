import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { stringField } from '../core/guards.ts';
import { parseObject, toJsonlLine, VERSION_FIELD } from '../core/jsonl.ts';

/** The format of a wake prompt file; a file in another format reads as no wake prompt. */
export const WAKE_PROMPT_FORMAT = 1;

/**
 * The prompt teamrig had a session submit: a wake check's answer to one tab, or the first prompt teamrig passed to a
 * Claude Code it started.
 */
export interface WakePrompt {
  /**
   * The Claude Code session of the tab told to submit it; absent for a first prompt passed to a new Claude Code, whose
   * session id is not known before it starts, so any tab's prompt can match it.
   */
  readonly tab?: string;
  readonly text: string;
}

/** A prompt a tab sent, matched against the stored wake prompt. */
export interface SentWakePrompt {
  readonly tab: string;
  readonly text: string;
}

/** A wake prompt file's content; undefined when it is damaged or from another format. */
export function parseWakePrompt(text: string): WakePrompt | undefined {
  const record = parseObject(text.trim());
  if (record === undefined || record[VERSION_FIELD] !== WAKE_PROMPT_FORMAT) {
    return undefined;
  }
  const tab = stringField(record, 'tab');
  const prompt = stringField(record, 'text');
  if (prompt === undefined) {
    return undefined;
  }
  return tab === undefined ? { text: prompt } : { tab, text: prompt };
}

export function formatWakePrompt(prompt: WakePrompt): string {
  return toJsonlLine({ [VERSION_FIELD]: WAKE_PROMPT_FORMAT, ...(prompt.tab === undefined ? {} : { tab: prompt.tab }), text: prompt.text });
}

/**
 * The text of each session's last wake or teamrig-passed first prompt, one small file per session (`<id>.prompt.json`), kept until a prompt in the
 * tab it woke matches it, so the turn log tells a prompt teamrig submitted from one the person typed. The match is
 * exact, outer white space aside: a wake text the person edited is theirs. Ids are session ids, checked by the
 * roster, so they are safe in a path.
 */
export class WakePrompts {
  private readonly files: Files;
  private readonly folder: string;

  constructor(files: Files, folder: string) {
    this.files = files;
    this.folder = folder;
  }

  async read(id: string): Promise<WakePrompt | undefined> {
    const text = await this.files.read(this.pathOf(id));
    return text === undefined ? undefined : parseWakePrompt(text);
  }

  /** Keeps the prompt a wake answered, in place of any earlier one. */
  async remember(id: string, prompt: WakePrompt): Promise<void> {
    await this.files.write(this.pathOf(id), formatWakePrompt(prompt));
  }

  /**
   * Whether `prompt` is the wake the tab was told to submit, or the first prompt teamrig passed (any tab). A match is
   * removed, so it marks one prompt only; of two hooks taking it at once, only the one that removed it is told true.
   */
  async take(id: string, prompt: SentWakePrompt): Promise<boolean> {
    const stored = await this.read(id);
    const tabMatches = stored?.tab === undefined || stored.tab === prompt.tab;
    if (stored === undefined || !tabMatches || stored.text.trim() !== prompt.text.trim()) {
      return false;
    }
    return this.files.remove(this.pathOf(id));
  }

  /** Removes the tab's wake that Claude Code dropped; a later wake of another tab is kept. */
  async forget(id: string, tab: string): Promise<void> {
    if ((await this.read(id))?.tab === tab) {
      await this.files.remove(this.pathOf(id));
    }
  }

  private pathOf(id: string): string {
    return join(this.folder, `${id}.prompt.json`);
  }
}
