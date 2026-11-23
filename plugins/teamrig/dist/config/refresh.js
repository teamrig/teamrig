import { AUTO_RESTART_LEAD } from "./types.js";
/** Whether the automatic restart is on for session `id`: `lead` turns it on for the team's lead only. */
export function autoRestartOf(config, id) {
    const { autoRestart } = config.refresh;
    return autoRestart === AUTO_RESTART_LEAD ? config.roles.lead === id : autoRestart;
}
/**
 * The refresh settings of session `id`: one threshold, `contextTokens`, for every session whatever its context window
 * (T4083), as a 1M window's larger one left a tab that never reached it unrefreshed.
 */
export function sessionRefreshOf(config, _id) {
    return config.refresh;
}
