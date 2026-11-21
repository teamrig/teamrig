import { isRecord, isStringArray } from "../core/guards.js";
import { adapterEntry, declarationProblems } from "./declaration.js";
/** The default export of a host adapter's entry. */
export function defineHost(adapter) {
    return adapter;
}
/** A name every shell teamrig reads takes for an environment variable. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * What a host declaring no mark is told. A command that acts as the owner runs only outside an agent's run, and a
 * mark is all that tells teamrig the two apart, so a host without one is refused at its load and the text says what
 * to declare.
 */
export const NO_AGENT_MARK = "it declares no mark of an agent's run: sessionVariables.marks must name an environment variable the tool sets in what its agent runs (its tools, what they run, its hooks) and in nothing the person starts";
function isVariableNames(value) {
    return isStringArray(value) && value.every((name) => VARIABLE_NAME.test(name));
}
/** What is wrong with the session variables a host declares; a declaration that is no object is told so elsewhere. */
function sessionVariableProblems(value) {
    if (!isRecord(value)) {
        return [];
    }
    const variables = value['sessionVariables'];
    const marks = isRecord(variables) ? variables['marks'] : undefined;
    const identity = isRecord(variables) ? variables['identity'] : undefined;
    const noMark = marks === undefined || (Array.isArray(marks) && marks.length === 0);
    return [
        ...(noMark ? [NO_AGENT_MARK] : isVariableNames(marks) ? [] : ['its sessionVariables.marks must be names of environment variables']),
        ...(isVariableNames(identity) ? [] : ['its sessionVariables.identity must be names of environment variables, an empty list when it has none']),
    ];
}
export function hostDeclarationProblems(value) {
    return [...declarationProblems('host', value), ...sessionVariableProblems(value)];
}
export function isHostDeclaration(value) {
    return hostDeclarationProblems(value).length === 0;
}
/** What stops `value` from being a host adapter's entry; empty when it is one. */
export function hostAdapterProblems(value) {
    const entry = adapterEntry(value, 'create');
    return entry === undefined ? ['its entry is not made by defineHost: it needs a declaration and a create function'] : hostDeclarationProblems(entry.declaration);
}
export function isHostAdapter(value) {
    return hostAdapterProblems(value).length === 0;
}
