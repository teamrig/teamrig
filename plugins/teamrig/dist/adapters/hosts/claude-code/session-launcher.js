import { unsupported } from "../../../plugin-api/index.js";
import { CHILD_ENVIRONMENT } from "./child-env.js";
import { declaration } from "./declaration.js";
import { launchArgs, PROGRAM } from "./launch-args.js";
import { backgroundJobSession, isForkOf } from "./session-command-lines.js";
import { sessionPlaceOf } from "./session-place.js";
import { isSessionProcess } from "./session-process.js";
import { ENTRYPOINT, PROJECT_DIR, SESSION_ID, SESSION_VARIABLES } from "./session-variables.js";
/** `bg` for a background session; unset for any other. */
const SESSION_KIND = 'CLAUDE_CODE_SESSION_KIND';
/** Forces one effort level on every session Claude Code starts, whatever the session picked. */
const EFFORT_LEVEL = 'CLAUDE_CODE_EFFORT_LEVEL';
/** Claude Code has no command that hands a running session a prompt: the teamrig mod in its tab submits a wake. */
const NO_WAKE = unsupported("Claude Code's tab submits a wake through the teamrig mod");
/** The variable's value trimmed, or undefined when it is unset or blank: a blank one tells nothing. */
function told(env, name) {
    const value = env[name]?.trim();
    return value ? value : undefined;
}
/** Claude Code's sessions, in the environment of one run. */
export function sessionLauncher(env) {
    return {
        programName: declaration.name,
        program: PROGRAM,
        launchArgs,
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
        isForkOf,
        backgroundJobSession,
        sessionPlaceOf,
        wake: NO_WAKE,
    };
}
