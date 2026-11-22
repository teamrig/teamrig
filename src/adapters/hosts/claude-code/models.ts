import type { HostModels } from '../../../plugin-api/index.ts';

/** Leaves the model to Claude Code: a launch passes no `--model` for it. */
const DEFAULT_NAME = 'default';

/**
 * The model aliases Claude Code documents for `--model` and `/model`: `best` is Fable where the account has it, else
 * Opus; `opusplan` plans on Opus and works on Sonnet; `[1m]` asks for the 1M-token context window.
 */
const ALIASES = [DEFAULT_NAME, 'best', 'fable', 'opus', 'sonnet', 'haiku', 'opusplan', 'fable[1m]', 'opus[1m]', 'sonnet[1m]', 'opusplan[1m]'] as const;

/** A full model id, such as `claude-opus-5-5`, with an optional `[1m]` window suffix. */
const MODEL_ID_PATTERN = /^claude-[a-z0-9]+(?:[.@-][a-z0-9]+)*(?:\[1m\])?$/;
const MODEL_ID_MAX_LENGTH = 100;

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const;
type Family = (typeof FAMILIES)[number];

/** Lowercase, without a `[1m]` window suffix: the window does not change which model runs. */
function bare(model: string): string {
  return model.toLowerCase().replace(/\[[^\]]*\]$/, '');
}

function familyOf(model: string): Family | undefined {
  return FAMILIES.find((family) => new RegExp(`(?:^|[^a-z])${family}(?:[^a-z]|$)`).test(model));
}

function isFamily(value: string): value is Family {
  return FAMILIES.some((family) => family === value);
}

/**
 * A family alias matches any model of that family; `opusplan` runs on Opus and Sonnet; `best` on Fable; a full id
 * matches itself with or without a date or provider wrapping. A running model of no known family is never wrong.
 */
function isOtherModel(wanted: string, running: string): boolean {
  const want = bare(wanted);
  const run = bare(running);
  const family = familyOf(run);
  if (want === DEFAULT_NAME || family === undefined) {
    return false;
  }
  if (want === 'best') {
    return family !== 'fable';
  }
  if (want === 'opusplan') {
    return family !== 'opus' && family !== 'sonnet';
  }
  if (isFamily(want)) {
    return family !== want;
  }
  return !run.includes(want) && !want.includes(run);
}

/**
 * Claude Code's models. The lead starts on Opus (the `opus` alias, its newest Opus) at xhigh effort, since it plans,
 * splits and judges the whole team's work. Not `best`: in a lead A/B, Fable at xhigh judged no better than Opus and
 * cost 2.4 times as much.
 */
export const hostModels: HostModels = {
  defaultName: DEFAULT_NAME,
  aliases: ALIASES,
  problemOf: (model) =>
    ALIASES.some((alias) => alias === model) || (model.length <= MODEL_ID_MAX_LENGTH && MODEL_ID_PATTERN.test(model))
      ? undefined
      : `expected a model alias (${ALIASES.join(', ')}) or a model id starting claude-`,
  leadDefault: { model: 'opus', effort: 'xhigh' },
  isOtherModel,
  switchModelStep: (model) => `/model ${model}`,
  switchEffortStep: (effort) => `/effort ${effort}`,
  switchNoteOf: (model) => (model === 'best' ? 'if this account has no Fable, best is Opus and nothing needs changing' : undefined),
};
