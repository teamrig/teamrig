import type { HostDeps, SessionLauncher } from '../../../plugin-api/index.ts';
import { CHILD_ENVIRONMENT } from './child-env.ts';
import { ENTRYPOINT, PROJECT_DIR, SESSION_ID, SESSION_VARIABLES } from './session-variables.ts';

/** `bg` for a background session; unset for any other. */
const SESSION_KIND = 'CLAUDE_CODE_SESSION_KIND';

/** The variable's value trimmed, or undefined when it is unset or blank: a blank one tells nothing. */
function told(env: HostDeps['env'], name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Claude Code's sessions, in the environment of one run. */
export function sessionLauncher(env: HostDeps['env']): SessionLauncher {
  return {
    variables: SESSION_VARIABLES,
    childEnv: CHILD_ENVIRONMENT,
    identity: () => ({
      projectDir: told(env, PROJECT_DIR),
      startedAs: told(env, ENTRYPOINT),
      sessionKind: told(env, SESSION_KIND),
      sessionId: told(env, SESSION_ID),
    }),
  };
}
