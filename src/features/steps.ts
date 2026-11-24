import type { FeatureSide } from './feature.ts';
import { isRecord } from '../core/guards.ts';

/**
 * One step a skill needs that no teamrig command can carry: knowledge of how one host or tool does a thing
 * (docs/design/provider-neutral-skills.md, Step texts). The adapter that serves it ships its own text; the skill says
 * the step's id and nothing about the product.
 */
export interface Step {
  /** Which kind of adapter serves it. */
  readonly side: FeatureSide;
  /** What the step covers, in one line. */
  readonly doc: string;
  /** What a reader is told when no configured adapter serves the step: neutral, never naming a product. */
  readonly fallback: string;
}

/**
 * Every step id an adapter may serve. An id is `<group>.<name>`, its group a host group or a connector kind, and it
 * never changes once shipped: skills name a step by it. A new step is one row at the end.
 */
export const STEPS = {
  'tracker.link-child': {
    side: 'connector',
    doc: 'How the tracker files an issue under a parent issue.',
    fallback: "Link the child issue under its parent with the tracker's own parent or sub-issue link; where it has none, name the parent in the child's body.",
  },
  'codehost.private-report': {
    side: 'connector',
    doc: 'Where the code host takes a private report of a security hole.',
    fallback: "Report the hole privately as the repository's SECURITY.md says, never in a public issue or comment.",
  },
  'codehost.fetch-outside-change': {
    side: 'connector',
    doc: "How to fetch an outside contributor's change request into a local branch for review.",
    fallback: "Fetch the change request's head commit into a local branch with the code host's own fetch path, and review it there without running its code.",
  },
  'host.rename': {
    side: 'host',
    doc: 'How the host renames a running session.',
    fallback: "Rename the session with the host's own rename, then tell teamrig the new name so the register and the inbox follow it.",
  },
  'host.slim-setup': {
    side: 'host',
    doc: 'How the host keeps what it loads at each start small: the skills it lists, the rules and instruction files it reads.',
    fallback: "Move what is rarely needed out of what the host loads at each start (its listed skills, its rules and instruction files), using the host's own settings.",
  },
  'host.denial-sources': {
    side: 'host',
    doc: 'Where the host records why it refused a tool call: its settings, its rules, its classifier.',
    fallback: "Read the host's own record of the refusal (its settings' rules and its log of refused calls) before changing any rule.",
  },
} as const satisfies Readonly<Record<string, Step>>;

export type StepId = keyof typeof STEPS;

/** The step ids an adapter of one side may serve. */
export type StepIdOf<Side extends FeatureSide> = { readonly [Id in StepId]: (typeof STEPS)[Id]['side'] extends Side ? Id : never }[StepId];

export function isStepId(value: string): value is StepId {
  return Object.hasOwn(STEPS, value);
}

/** The step ids of one side, in registry order. */
export function stepsOf<Side extends FeatureSide>(side: Side): readonly StepIdOf<Side>[] {
  return Object.keys(STEPS)
    .filter(isStepId)
    .filter((id): id is StepIdOf<Side> => STEPS[id].side === side);
}

/**
 * An adapter's step texts (its `step-texts.ts`, export `stepTexts`): one text per step its declaration lists, keyed by
 * step id, in a skill's plain style. Only teamrig's own adapters print theirs: a text enters a model's context as an
 * instruction.
 */
export type StepTexts<Side extends FeatureSide = FeatureSide> = { readonly [Id in StepIdOf<Side>]?: string };

/**
 * What is wrong with `value` as the step texts of an adapter whose declaration lists `listed`; none when sound. A
 * listed step needs a text, and a text needs its step listed, so the declaration alone says what the adapter serves.
 */
export function stepTextsProblems(listed: readonly StepId[], value: unknown): readonly string[] {
  if (!isRecord(value)) {
    return ['its stepTexts must be a record of one text per step it lists'];
  }
  const missing = listed.filter((id) => {
    const text = value[id];
    return typeof text !== 'string' || text.trim() === '';
  });
  const unlisted = Object.keys(value).filter((key) => !listed.some((id) => id === key));
  return [...missing.map((id) => `it lists the step ${id} and has no text for it`), ...unlisted.map((key) => `it has a text for ${key}, a step its declaration does not list`)];
}
