import { isRecord, recordField, stringField, type JsonRecord, type StatusLine, type StatusLineAnswer, type StatusReading } from '../../../plugin-api/index.ts';

/**
 * How `teamrig statusline install` and `uninstall` change Antigravity CLI's `statusLine` setting, in
 * `~/.gemini/antigravity-cli/settings.json`, and how its status input reads.
 *
 * agy runs the command through `sh -c`, or `cmd /c` on Windows, with one JSON object on stdin, at most every 300 ms.
 * As on Claude Code, the launcher goes in front of a status line already there (`<launcher> --pass | <theirs>`), so
 * theirs runs as before. agy draws its own line too, and `stack_with_default` keeps it beside ours, so a status line
 * the launcher writes sets it, and `enabled`, which agy reads as off when false. The fields come from
 * `https://antigravity.google/docs/cli/statusline/` as read 2026-11-20 for agy 1.5.12, none from a running agy yet:
 * a field this reads that the live read (T4770) does not confirm is left undefined rather than guessed.
 */

/** The settings key agy reads the status line from. */
export const STATUS_LINE_KEY = 'statusLine';
const PASS_PIPE = ' --pass | ';

/** The command that runs the launcher; forward slashes work in both `sh -c` and `cmd /c`. */
export function launcherCommand(launcher: string): string {
  return `node "${launcher.replaceAll('\\', '/')}"`;
}

/** The fields the launcher's status line carries besides its command: agy's own line stays shown beside it. */
const OWN_FIELDS: JsonRecord = { type: 'command', enabled: true, stack_with_default: true };

/** Puts the launcher in as the status line, in front of the one already there. */
export function planInstall(settings: JsonRecord, launcher: string): StatusLineAnswer {
  const own = launcherCommand(launcher);
  const current = currentCommand(settings);
  if (!current.ok) {
    return current;
  }
  const before = current.value;
  if (before === undefined) {
    return { ok: true, value: { settings: { ...settings, [STATUS_LINE_KEY]: { ...OWN_FIELDS, command: own } }, before, after: own } };
  }
  if (passesToNothing(before, own)) {
    return { ok: true, value: { settings: withCommand(settings, own), before, after: own } };
  }
  if (isLaunchedBy(before, own)) {
    const settled = isOn(settings) ? undefined : withCommand(settings, before);
    return { ok: true, value: { settings: settled, before, after: before } };
  }
  const operator = compoundOperator(before);
  if (operator !== undefined) {
    return {
      ok: false,
      problem: `the status line already there is a shell line with ${operator}, which the pipe in front would split: put it in a script, make that the status line, and run install again`,
    };
  }
  const after = `${own}${PASS_PIPE}${before}`;
  return { ok: true, value: { settings: withCommand(settings, after), before, after } };
}

/** Takes the launcher back out: the status line that was there before it returns, or none when there was none. */
export function planUninstall(settings: JsonRecord, launcher: string): StatusLineAnswer {
  const own = launcherCommand(launcher);
  const current = currentCommand(settings);
  if (!current.ok) {
    return current;
  }
  const before = current.value;
  if (before === undefined || !isLaunchedBy(before, own)) {
    return { ok: true, value: { settings: undefined, before, after: before } };
  }
  if (before === own || passesToNothing(before, own)) {
    const rest = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== STATUS_LINE_KEY));
    return { ok: true, value: { settings: rest, before, after: undefined } };
  }
  if (!before.startsWith(`${own}${PASS_PIPE}`)) {
    return { ok: false, problem: `the status line starts with the launcher but was changed by hand: edit ${STATUS_LINE_KEY}.command yourself` };
  }
  const after = before.slice(own.length + PASS_PIPE.length);
  return { ok: true, value: { settings: { ...settings, [STATUS_LINE_KEY]: { ...statusLineOf(settings), command: after } }, before, after } };
}

function isLaunchedBy(command: string, own: string): boolean {
  return command === own || command.startsWith(`${own} `);
}

/** The launcher passing the status input on with no command after it: agy would show that input raw. */
function passesToNothing(command: string, own: string): boolean {
  return command.startsWith(`${own} `) && /^--pass(\s*\|)?$/.test(command.slice(own.length).trim());
}

/** Whether the status line is switched on and stacked beside agy's own, as the launcher writes it. */
function isOn(settings: JsonRecord): boolean {
  const line = statusLineOf(settings);
  return line['enabled'] !== false && line['stack_with_default'] === true;
}

/** The settings with the status line's command set to `command`, switched on beside agy's own, its other fields kept. */
function withCommand(settings: JsonRecord, command: string): JsonRecord {
  return { ...settings, [STATUS_LINE_KEY]: { ...statusLineOf(settings), enabled: true, stack_with_default: true, command } };
}

function statusLineOf(settings: JsonRecord): JsonRecord {
  const value = settings[STATUS_LINE_KEY];
  return isRecord(value) ? value : {};
}

type Command = { readonly ok: true; readonly value: string | undefined } | { readonly ok: false; readonly problem: string };

/** The status line's command; undefined when there is no status line. A status line without a command is refused. */
function currentCommand(settings: JsonRecord): Command {
  const value = settings[STATUS_LINE_KEY];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  const command = isRecord(value) ? stringField(value, 'command') : undefined;
  return command === undefined ? { ok: false, problem: `${STATUS_LINE_KEY} has no command string, so nothing can be added in front of it` } : { ok: true, value: command };
}

/**
 * The first operator outside quotes that ends a command in `sh -c` or `cmd /c`, named for a message: `&&`, `||`, `;`,
 * a line break, or a lone `&`, which `cmd` runs as a second command. A `&` in a redirect (`2>&1`, `<&0`) is none. A
 * pipe in front of such a line would feed only the part before it. A backslash escapes the next character, as in sh.
 */
export function compoundOperator(command: string): string | undefined {
  let quote: string | undefined;
  for (let at = 0; at < command.length; at += 1) {
    const char = command[at];
    if (char === '\\' && quote !== "'") {
      at += 1;
    } else if (quote !== undefined) {
      quote = char === quote ? undefined : quote;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if ((char === '&' || char === '|') && command[at + 1] === char) {
      return `"${char}${char}"`;
    } else if (char === '&' && command[at - 1] !== '>' && command[at - 1] !== '<') {
      return '"&"';
    } else if (char === ';') {
      return '";"';
    } else if (char === '\n' || char === '\r') {
      return 'a line break';
    }
  }
  return undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function told(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function objectOf(input: string): JsonRecord | undefined {
  try {
    const value: unknown = JSON.parse(input);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The reading of agy's status input. The folder is `cwd`. The model is an object, `{ id, display_name, effort }`, null
 * until one is picked; its `display_name` is the name a person sees. That name already carries the effort, as in
 * `Gemini 4 Argon (Medium)`, so the effort stays undefined rather than shown twice; agy has no named agents either.
 * The host version waits for the live read (T4770), as the docs page does not say how `version` is written.
 * `cost.total_usd` is a list-price estimate (it carries `estimated`), not a bill, so it is not read as one. Context
 * tokens wait for the live read: the docs name the totals' fields only as such.
 */
function parse(input: string): StatusReading | undefined {
  const status = objectOf(input);
  if (status === undefined) {
    return undefined;
  }
  return {
    sessionId: told(status['session_id']),
    cwd: stringField(status, 'cwd') ?? '',
    agentName: undefined,
    model: told(recordField(status, 'model')?.['display_name']),
    effort: undefined,
    hostVersion: undefined,
    costUsd: undefined,
    contextUsedPct: finite(recordField(status, 'context_window')?.['used_percentage']),
    contextInputTokens: undefined,
  };
}

/** Antigravity CLI's status line. */
export const statusLine: StatusLine = { setting: STATUS_LINE_KEY, parse, install: planInstall, uninstall: planUninstall };
