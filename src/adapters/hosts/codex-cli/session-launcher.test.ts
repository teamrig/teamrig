import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { declaration } from './declaration.ts';
import { launchArgs, PROGRAM } from './launch-args.ts';
import { backgroundJobSession, isForkOf, sessionPlaceOf } from './session-command-lines.ts';
import { sessionLauncher } from './session-launcher.ts';
import { newestRestriction } from './turn-context.ts';
import { CODEX_WAKE } from './wake.ts';

const NONE = { projectDir: undefined, startedAs: undefined, sessionKind: undefined, sessionId: undefined, forcedEffort: undefined };

describe("Codex CLI's session launcher", () => {
  it("tells the conversation's id, trimmed, as the session's id and nothing else", () => {
    assert.deepEqual(sessionLauncher({ CODEX_THREAD_ID: ' thread-1 ' }).identity(), { ...NONE, sessionId: 'thread-1' });
  });

  it('tells nothing of a run no Codex session started, and reads a blank id as none', () => {
    assert.deepEqual(sessionLauncher({}).identity(), NONE);
    assert.deepEqual(sessionLauncher({ CODEX_THREAD_ID: ' ' }).identity(), NONE);
  });

  it("reads no other host's variables, nor Codex's per-call id", () => {
    const env = { CLAUDE_PROJECT_DIR: '/work/app', CLAUDE_CODE_SESSION_ID: 's-1', CODEX_TOOL_CALL_ID: 'call-1', PWD: '/tmp' };
    assert.deepEqual(sessionLauncher(env).identity(), NONE);
  });

  it("names the program and its session variables by its declaration's", () => {
    const launcher = sessionLauncher({ CODEX_THREAD_ID: 't' });
    assert.equal(launcher.programName, 'Codex CLI');
    assert.equal(launcher.variables, declaration.sessionVariables);
  });

  it("starts Codex's own program with its launch arguments and reads forks with its command-line reader", () => {
    const launcher = sessionLauncher({});
    assert.equal(launcher.program, PROGRAM);
    assert.equal(launcher.launchArgs, launchArgs);
    assert.equal(launcher.isForkOf, isForkOf);
    assert.equal(launcher.backgroundJobSession, backgroundJobSession);
    assert.equal(launcher.sessionPlaceOf, sessionPlaceOf);
  });

  it('wakes a session through codex queue', () => {
    assert.equal(sessionLauncher({}).wake, CODEX_WAKE);
  });

  it("reads the session's restriction from its rollout's newest turn (T5089)", () => {
    assert.equal(sessionLauncher({}).restrictionReading, newestRestriction);
  });

  it("reads the session id from the mark its declaration names", () => {
    const [mark] = declaration.sessionVariables.marks;
    assert.deepEqual(sessionLauncher({ [mark ?? '']: 't-2' }).identity(), { ...NONE, sessionId: 't-2' });
  });

  it("keeps the conversation and tool call from a child, parks only the conversation's id, and holds the API key for Codex", () => {
    const { childEnv } = sessionLauncher({});
    assert.deepEqual(childEnv.session, ['CODEX_THREAD_ID', 'CODEX_TOOL_CALL_ID']);
    assert.deepEqual(childEnv.parked, ['CODEX_THREAD_ID']);
    assert.ok(childEnv.parked.every((name) => childEnv.session.includes(name)));
    assert.deepEqual(childEnv.login, ['OPENAI_API_KEY']);
  });

  it("tells Codex's own program as a session's, and no other", () => {
    const { isSessionProcess } = sessionLauncher({});
    assert.equal(isSessionProcess({ name: 'codex.exe', commandLine: '' }), true);
    assert.equal(isSessionProcess({ name: 'node', commandLine: 'node /usr/lib/node_modules/@openai/codex/bin/codex.js' }), true);
    assert.equal(isSessionProcess({ name: 'claude.exe', commandLine: '' }), false);
    assert.equal(isSessionProcess({ name: 'node', commandLine: 'node server.js codex.js' }), false);
  });
});
