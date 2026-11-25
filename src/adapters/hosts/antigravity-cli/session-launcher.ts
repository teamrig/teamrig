import type { HostDeps, SessionLauncher } from '../../../plugin-api/index.ts';
import { CHILD_ENVIRONMENT, CONVERSATION_ID } from './child-env.ts';
import { declaration } from './declaration.ts';
import { launchArgs, PROGRAM } from './launch-args.ts';
import { backgroundJobSession, isForkOf, sessionPlaceOf } from './session-command-lines.ts';
import { isAntigravitySessionProcess } from './session-process.ts';

/** The variable's value trimmed, or undefined when it is unset or blank: a blank one tells nothing. */
function told(env: HostDeps['env'], name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Antigravity CLI's sessions, in the environment of one run. agy tells its hooks and what its tools run the
 * conversation's id, its mark, which is the session's id here. It tells no start folder, start word, kind or forced
 * effort in the environment, so those stay undefined.
 */
export function sessionLauncher(env: HostDeps['env']): SessionLauncher {
  return {
    programName: declaration.name,
    program: PROGRAM,
    launchArgs,
    variables: declaration.sessionVariables,
    childEnv: CHILD_ENVIRONMENT,
    identity: () => ({
      projectDir: undefined,
      startedAs: undefined,
      sessionKind: undefined,
      sessionId: told(env, CONVERSATION_ID),
      forcedEffort: undefined,
    }),
    isSessionProcess: isAntigravitySessionProcess,
    isForkOf,
    backgroundJobSession,
    sessionPlaceOf,
  };
}
