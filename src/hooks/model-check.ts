import { describeLaunch } from '../config/launch.ts';
import { isEffortLevel, type LaunchConfig } from '../config/types.ts';
import type { HostModels } from '../ports/host/index.ts';

/** What the host reports of the running session; each is absent when the hook was not told. */
export interface RunningSettings {
  /** The model id a session start's hook event names, such as `claude-opus-5-5`. */
  readonly model: string | undefined;
  /**
   * The effort level a turn end's hook event names. A session start's names none, and `$CLAUDE_EFFORT` is no
   * substitute there, since a session started from another session's shell can inherit that session's value.
   */
  readonly effort: string | undefined;
}

function present(part: string | undefined): part is string {
  return part !== undefined;
}

/**
 * The one line that tells a session it runs on another model or effort than its configured one,
 * with the steps that fix it; undefined when it matches or the host did not say. It never
 * blocks: the user may have chosen another model on purpose, or the account may lack it.
 */
export function modelCheckLine(models: HostModels, name: string, wanted: LaunchConfig, running: RunningSettings): string | undefined {
  const model = wanted.model !== undefined && running.model !== undefined && models.isOtherModel(wanted.model, running.model) ? wanted.model : undefined;
  const runningEffort = isEffortLevel(running.effort) ? running.effort : undefined;
  const effort = runningEffort !== undefined && wanted.effort !== undefined && runningEffort !== wanted.effort ? wanted.effort : undefined;
  if (model === undefined && effort === undefined) {
    return undefined;
  }
  const runs = [running.model === undefined ? undefined : `model ${running.model}`, runningEffort === undefined ? undefined : `at ${runningEffort} effort`];
  const fixes = [model === undefined ? undefined : models.switchModelStep(model), effort === undefined ? undefined : models.switchEffortStep(effort)];
  const note = model === undefined ? undefined : models.switchNoteOf(model);
  return `MODEL ${name} runs ${runs.filter(present).join(' ')}; the team config asks for ${describeLaunch(wanted)}: type ${fixes.filter(present).join(' and ')}${note === undefined ? '' : ` (${note})`}`;
}
