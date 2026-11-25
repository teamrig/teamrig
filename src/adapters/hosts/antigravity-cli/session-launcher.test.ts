import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { declaration } from './declaration.ts';
import { launchArgs, PROGRAM } from './launch-args.ts';
import { backgroundJobSession, isForkOf, sessionPlaceOf } from './session-command-lines.ts';
import { sessionLauncher } from './session-launcher.ts';

const NONE = { projectDir: undefined, startedAs: undefined, sessionKind: undefined, sessionId: undefined, forcedEffort: undefined };

describe("Antigravity CLI's session launcher", () => {
  it("tells the conversation's id, trimmed, as the session's id and nothing else", () => {
    assert.deepEqual(sessionLauncher({ ANTIGRAVITY_CONVERSATION_ID: ' conv-1 ' }).identity(), { ...NONE, sessionId: 'conv-1' });
  });

  it('tells nothing of a run no agy session started, and reads a blank id as none', () => {
    assert.deepEqual(sessionLauncher({}).identity(), NONE);
    assert.deepEqual(sessionLauncher({ ANTIGRAVITY_CONVERSATION_ID: ' ' }).identity(), NONE);
  });

  it("reads no other host's variables, nor agy's trajectory or project ids", () => {
    const env = { CLAUDE_CODE_SESSION_ID: 's-1', CODEX_THREAD_ID: 't-1', ANTIGRAVITY_TRAJECTORY_ID: 'tr-1', ANTIGRAVITY_PROJECT_ID: 'p-1' };
    assert.deepEqual(sessionLauncher(env).identity(), NONE);
  });

  it("names the program and its session variables by its declaration's, and reads the id from its mark", () => {
    const launcher = sessionLauncher({});
    assert.equal(launcher.programName, 'Antigravity CLI');
    assert.equal(launcher.variables, declaration.sessionVariables);
    const [mark] = declaration.sessionVariables.marks;
    assert.deepEqual(sessionLauncher({ [mark ?? '']: 'conv-2' }).identity(), { ...NONE, sessionId: 'conv-2' });
  });

  it("starts agy's own program with its launch arguments and reads command lines with its own reader", () => {
    const launcher = sessionLauncher({});
    assert.equal(launcher.program, PROGRAM);
    assert.equal(launcher.launchArgs, launchArgs);
    assert.equal(launcher.isForkOf, isForkOf);
    assert.equal(launcher.backgroundJobSession, backgroundJobSession);
    assert.equal(launcher.sessionPlaceOf, sessionPlaceOf);
  });

  it('keeps every variable agy set for its tools from a child, the CSRF token among them, and parks only the id', () => {
    const { childEnv, variables } = sessionLauncher({});
    assert.ok(childEnv.session.includes('ANTIGRAVITY_CSRF_TOKEN'));
    assert.ok(childEnv.session.includes('ANTIGRAVITY_LS_ADDRESS'));
    assert.ok(variables.marks.every((name) => childEnv.session.includes(name)));
    assert.deepEqual(childEnv.parked, ['ANTIGRAVITY_CONVERSATION_ID']);
    assert.ok(childEnv.parked.every((name) => childEnv.session.includes(name)));
    assert.deepEqual(childEnv.login, []);
  });

  it("tells agy's own program as a session's, and no other", () => {
    const { isSessionProcess } = sessionLauncher({});
    assert.equal(isSessionProcess({ name: 'agy.exe', commandLine: '' }), true);
    assert.equal(isSessionProcess({ name: 'claude.exe', commandLine: '' }), false);
  });
});
