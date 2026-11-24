import { isRecord, isStringArray, stringField } from "../core/guards.js";
import { STEPS, isStepId } from "../features/steps.js";
import { manifestProblems } from "./support.js";
import { isApiVersion } from "./version.js";
export const ADAPTER_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** What stops `value` from being the declaration of an adapter of one side; empty when it is one. */
export function declarationProblems(side, value) {
    if (!isRecord(value)) {
        return ['its declaration is not an object'];
    }
    const apiVersion = stringField(value, 'apiVersion');
    const id = stringField(value, 'id');
    const name = stringField(value, 'name');
    return [
        ...(apiVersion !== undefined && isApiVersion(apiVersion) ? [] : ['its apiVersion must be a version like 1.0.0']),
        ...(id !== undefined && ADAPTER_ID.test(id) ? [] : ['its id must be lower-case words joined by -']),
        ...(name !== undefined && name.trim() !== '' ? [] : ['it needs a name']),
        ...manifestProblems(side, value['manifest']),
        ...stepsProblems(side, value['steps']),
        ...(termsSound(value['terms']) ? [] : ['its terms must be words of its product, one line each, each once']),
    ];
}
/** What is wrong with the steps a declaration lists; none when it lists none. */
function stepsProblems(side, steps) {
    if (steps === undefined) {
        return [];
    }
    if (!isStringArray(steps) || new Set(steps).size !== steps.length) {
        return [`its steps must list ${side} steps of the step registry, each once`];
    }
    return steps.filter((id) => !isStepId(id) || STEPS[id].side !== side).map((id) => `its steps name ${id}, which is no ${side} step of the step registry`);
}
/** Whether a declaration's terms are sound; a term matches case-blind, so two spellings of one word are one term twice. */
function termsSound(terms) {
    if (terms === undefined) {
        return true;
    }
    return isStringArray(terms) && terms.every((term) => term.trim() !== '' && !term.includes('\n')) && new Set(terms.map((term) => term.toLowerCase())).size === terms.length;
}
/** The entry when `value` has the shape `defineHost`, `defineConnector` or `defineTerminal` returns: a declaration and the function `needs` names. */
export function adapterEntry(value, needs) {
    return isRecord(value) && typeof value[needs] === 'function' ? { declaration: value['declaration'] } : undefined;
}
