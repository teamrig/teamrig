/**
 * An environment variable of the host that overrides an effort or helper model chosen anywhere else, and what it
 * does to the sessions and helpers that get it. `doctor` warns when one is set.
 */
export interface RoutingOverride {
  /** `effort` beats every effort a session or helper is given; `model` beats every helper model its caller gives. */
  readonly kind: 'effort' | 'model';
  /** The variable's name. */
  readonly variable: string;
  /** What the variable at `value` does, as a clause doctor's warning goes on from. */
  effect(value: string): string;
}

/**
 * The models a host runs and how a person switches between them: the names a session's `launch.<id>.model` may
 * hold, the model and effort the lead starts on, whether a running model is the one asked for, and the steps a
 * person types to change either. Effort levels are teamrig's own scale (`low` to `max`), which the core keeps.
 */
export interface HostModels {
  /** The host's variables that override an effort or helper model; none on a host that has no such variable. */
  readonly routingOverrides: readonly RoutingOverride[];
  /** The name that leaves the model to the host: a launch passes no model for it. */
  readonly defaultName: string;
  /** The model names the host takes besides a full model id, `defaultName` among them. */
  readonly aliases: readonly string[];
  /** Why the name is no model the host takes, as a short `expected ...` text; undefined when it takes it. */
  problemOf(model: string): string | undefined;
  /**
   * The model and effort the lead starts on for each one its `launch` entry leaves unset: good value for planning
   * and judging the team's work, never the dearest model.
   */
  readonly leadDefault: { readonly model: string; readonly effort: string };
  /**
   * Whether the running model is clearly not the one asked for. A running model the host cannot place is never
   * called wrong: the person may run another one on purpose.
   */
  isOtherModel(wanted: string, running: string): boolean;
  /** What a person types in the session to switch it to the model. */
  switchModelStep(model: string): string;
  /** What a person types in the session to switch it to the effort level. */
  switchEffortStep(effort: string): string;
  /** A note beside a switch to the model, such as an alias that runs another model on some accounts. */
  switchNoteOf(model: string): string | undefined;
}
