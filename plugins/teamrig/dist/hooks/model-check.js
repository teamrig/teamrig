import { describeLaunch } from "../config/launch.js";
import { isEffortLevel } from "../config/types.js";
function present(part) {
    return part !== undefined;
}
/**
 * The one line that tells a session it runs on another model or effort than its configured one,
 * with the steps that fix it; undefined when it matches or the host did not say. It never
 * blocks: the user may have chosen another model on purpose, or the account may lack it.
 */
export function modelCheckLine(models, name, wanted, running) {
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
