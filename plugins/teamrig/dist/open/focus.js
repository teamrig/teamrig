import { terminalPortOf } from "../composition/terminal-ports.js";
import { candidatesOf } from "./open-tab.js";
/** Brings the tab titled `title` to the front in the chosen terminal, or the first `auto` finds that has it. */
export async function focusTab(deps, choice, title) {
    const reasons = [];
    const titleless = [];
    const terminalDeps = { env: deps.env, platform: deps.platform, processes: deps.processes, cwd: deps.cwd };
    for (const terminal of candidatesOf(choice, deps)) {
        const reach = await terminalPortOf(terminal, terminalDeps, deps.importer);
        if (reach.kind === 'refused') {
            reasons.push(`${terminal}: ${reach.why}`);
            continue;
        }
        const answer = await reach.port.focus(title);
        switch (answer.kind) {
            case 'done':
                return { kind: 'focused', terminal };
            case 'selected':
                return { kind: 'behind', terminal };
            case 'gone':
                reasons.push(`${terminal} has no tab titled ${title}`);
                break;
            case 'unserved':
                titleless.push(terminal);
                break;
            case 'failed':
                reasons.push(`${terminal}: ${answer.why}`);
                break;
        }
    }
    if (titleless.length > 0) {
        reasons.push(`${titleless.join(', ')} cannot select a tab by its title`);
    }
    return { kind: 'none', reasons: reasons.length === 0 ? ['the terminal setting is print'] : reasons };
}
