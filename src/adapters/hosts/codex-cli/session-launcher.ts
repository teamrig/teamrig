import type { HostDeps, SessionLauncher } from '../../../plugin-api/index.ts';
import { CHILD_ENVIRONMENT } from './child-env.ts';
import { declaration } from './declaration.ts';
import { launchArgs, PROGRAM } from './launch-args.ts';
import { backgroundJobSession, isForkOf, sessionPlaceOf } from './session-command-lines.ts';
import { isCodexSessionProcess } from './session-process.ts';
import { AGENT_MARK } from './session-variables.ts';

/** The variable's value trimmed, or undefined when it is unset or blank: a blank one tells nothing. */
function told(env: HostDeps['env'], name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Codex CLI's sessions, in the environment of one run. Codex tells what its shell tool runs only the conversation's
 * id, its mark, which is the session's id here. It tells no start folder, start word, kind or forced effort in the
 * environment, so those stay undefined.
 */
export function sessionLauncher(env: HostDeps['env']): SessionLauncher {
  return {
    programName: declaration.name,
    program: PROGRAM,
    // Codex loads no plugin folder: a team naming one is refused before Codex starts.
    pluginManifest: undefined,
    launchArgs,
    variables: declaration.sessionVariables,
    childEnv: CHILD_ENVIRONMENT,
    identity: () => ({
      projectDir: undefined,
      startedAs: undefined,
      sessionKind: undefined,
      sessionId: told(env, AGENT_MARK),
      forcedEffort: undefined,
    }),
    isSessionProcess: isCodexSessionProcess,
    isForkOf,
    backgroundJobSession,
    sessionPlaceOf,
  };
}
