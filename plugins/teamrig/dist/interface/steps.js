import { ServedText } from "./text.js";
/**
 * The `steps` document's body. A preview line quotes the config file's values, which a hand edit may have filled, so
 * each is looked at for a secret's shape by itself, and so is every other text.
 */
export function stepsBody(input) {
    const served = new ServedText(input.shapes);
    const steps = input.steps.map((step) => ({
        id: step.id,
        title: served.plain(step.id, 'title', step.title),
        why: served.plain(step.id, 'why', step.why),
        preview: step.preview.map((line) => served.plain(step.id, 'preview', line)),
        command: step.command,
    }));
    return { steps, cuts: served.cuts };
}
