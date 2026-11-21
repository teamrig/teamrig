import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHILD_ENVIRONMENT } from './child-env.ts';
import { sessionLauncher } from './session-launcher.ts';
import { SESSION_VARIABLES } from './session-variables.ts';

describe("Claude Code's child environment", () => {
  it('names every variable a session sets for its own tools, which a session or step started from one never inherits', () => {
    assert.deepEqual(CHILD_ENVIRONMENT.session, [
      'CLAUDECODE',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_EXECPATH',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_SESSION_ATTENDED',
      'CLAUDE_PID',
      'CLAUDE_PROJECT_DIR',
    ]);
  });

  it('counts the mark and the identity variables it tells a run by among them', () => {
    for (const name of [...SESSION_VARIABLES.marks, ...SESSION_VARIABLES.identity]) {
      assert.ok(CHILD_ENVIRONMENT.session.includes(name), name);
    }
  });

  it("lets a parked step keep only what resolves its parker's tab: session variables, and neither the messaging token nor the socket", () => {
    assert.deepEqual(CHILD_ENVIRONMENT.parked, ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PROJECT_DIR']);
    assert.ok(CHILD_ENVIRONMENT.parked.every((name) => CHILD_ENVIRONMENT.session.includes(name)));
  });

  it("names Claude Code's own login, which is no session variable", () => {
    assert.deepEqual(CHILD_ENVIRONMENT.login, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']);
    assert.ok(CHILD_ENVIRONMENT.login.every((name) => !CHILD_ENVIRONMENT.session.includes(name)));
  });

  it('is what the session launcher hands a run, whatever the environment holds', () => {
    assert.equal(sessionLauncher({}).childEnv, CHILD_ENVIRONMENT);
    assert.equal(sessionLauncher({ CLAUDECODE: '1', ANTHROPIC_API_KEY: 'not-a-real-credential' }).childEnv, CHILD_ENVIRONMENT);
  });
});
