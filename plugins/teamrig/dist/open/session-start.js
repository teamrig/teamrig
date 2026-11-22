import { isDefaultModel } from "../config/launch.js";
/**
 * What a launch asks of the host's session launcher: the session's settings with what this start adds to them. The
 * `default` model is teamrig's own config word for "the host's", which no host knows, so it names no model here and
 * the host keeps its own; the launcher spells every flag.
 */
export function sessionStartOf(settings, rest) {
    const { model, effort } = settings;
    return { ...rest, model: isDefaultModel(model) ? undefined : model, effort };
}
