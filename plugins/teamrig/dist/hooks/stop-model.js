import { modelCheckLine } from "./model-check.js";
import { fallbackLine, readLastFallback } from "./model-fallback.js";
function effortNotice(models, input) {
    const line = modelCheckLine(models, input.name, input.launch, { model: undefined, effort: input.effort });
    return line === undefined ? undefined : { key: `effort:${input.effort ?? ''}`, line };
}
async function fallbackNotice(reader, models, files, input) {
    const fallback = reader === undefined || input.transcript === undefined ? undefined : await readLastFallback(reader, files, input.transcript);
    return fallback === undefined ? undefined : { key: `fallback:${fallback.id}`, line: fallbackLine(models, input.name, fallback, input.launch.model) };
}
function isNotice(notice) {
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
export async function stopModelNotices(reader, models, files, store, input) {
    if (models === undefined) {
        return [];
    }
    const found = [effortNotice(models, input), await fallbackNotice(reader, models, files, input)].filter(isNotice);
    if (found.length === 0) {
        return [];
    }
    const told = await store.told(input.id, input.claude);
    const fresh = found.filter((notice) => !told.includes(notice.key));
    if (fresh.length > 0) {
        await store.remember(input.id, input.claude, fresh.map((notice) => notice.key));
    }
    return fresh.map((notice) => notice.line);
}
