import { CHILD_ENVIRONMENT } from "./child-env.js";
import { declaration } from "./declaration.js";
import { isSessionProcess } from "./session-process.js";
import { ENTRYPOINT, PROJECT_DIR, SESSION_ID, SESSION_VARIABLES } from "./session-variables.js";
/** `bg` for a background session; unset for any other. */
const SESSION_KIND = 'CLAUDE_CODE_SESSION_KIND';
/** Forces one effort level on every session Claude Code starts, whatever the session picked. */
const EFFORT_LEVEL = 'CLAUDE_CODE_EFFORT_LEVEL';
/** The variable's value trimmed, or undefined when it is unset or blank: a blank one tells nothing. */
function told(env, name) {
    const value = env[name]?.trim();
    return value ? value : undefined;
}
/** Claude Code's sessions, in the environment of one run. */
export function sessionLauncher(env) {
    return {
        programName: declaration.name,
        variables: SESSION_VARIABLES,
        childEnv: CHILD_ENVIRONMENT,
        identity: () => ({
            projectDir: told(env, PROJECT_DIR),
            startedAs: told(env, ENTRYPOINT),
            sessionKind: told(env, SESSION_KIND),
            sessionId: told(env, SESSION_ID),
            forcedEffort: told(env, EFFORT_LEVEL),
        }),
        isSessionProcess,
    };
}
