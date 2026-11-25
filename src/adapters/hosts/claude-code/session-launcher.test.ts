import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { isUnsupported } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { sessionLauncher } from './session-launcher.ts';

const PROJECT = join('/', 'work', 'app');
const NONE = { projectDir: undefined, startedAs: undefined, sessionKind: undefined, sessionId: undefined, forcedEffort: undefined };

describe("Claude Code's session launcher", () => {
  it('tells the folder the session started in, how Claude Code was started, the kind of session, its id and a forced effort, each trimmed', () => {
    const env = { CLAUDE_PROJECT_DIR: ` ${PROJECT} `, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_KIND: ' bg ', CLAUDE_CODE_SESSION_ID: ' s-1 ', CLAUDE_CODE_EFFORT_LEVEL: ' high ' };
    assert.deepEqual(sessionLauncher(env).identity(), { projectDir: PROJECT, startedAs: 'cli', sessionKind: 'bg', sessionId: 's-1', forcedEffort: 'high' });
  });

  it('tells nothing of a run no session started, and reads a blank value as none', () => {
    assert.deepEqual(sessionLauncher({}).identity(), NONE);
    const blank = { CLAUDE_PROJECT_DIR: '', CLAUDE_CODE_ENTRYPOINT: ' ', CLAUDE_CODE_SESSION_KIND: '\t', CLAUDE_CODE_SESSION_ID: ' ', CLAUDE_CODE_EFFORT_LEVEL: ' ' };
    assert.deepEqual(sessionLauncher(blank).identity(), NONE);
  });

  it("names the program by its declaration's name, whatever the environment holds", () => {
    assert.equal(sessionLauncher({}).programName, declaration.name);
    assert.equal(sessionLauncher({ CLAUDE_CODE_SESSION_ID: 's-1' }).programName, 'Claude Code');
  });

  it('wakes no session through its program: the mod in the tab submits a wake', () => {
    assert.ok(isUnsupported(sessionLauncher({}).wake));
  });

  it('reads no variable but its own five', () => {
    const env = { CLAUDE_PROJECT_DIR: PROJECT, PWD: join('/', 'tmp'), CLAUDECODE: '1', TEAMRIG_SESSION: 'dev' };
    assert.deepEqual(sessionLauncher(env).identity(), { ...NONE, projectDir: PROJECT });
  });

  it('hands a run the session variables its declaration names, whatever the environment holds', () => {
    assert.equal(sessionLauncher({}).variables, declaration.sessionVariables);
    assert.equal(sessionLauncher({ CLAUDECODE: '1' }).variables, declaration.sessionVariables);
  });

  it('reads the session id and the start folder from the variables it declares as identity', () => {
    const [sessionId, projectDir] = declaration.sessionVariables.identity;
    assert.deepEqual(sessionLauncher({ [sessionId ?? '']: 's-2', [projectDir ?? '']: PROJECT }).identity(), { ...NONE, projectDir: PROJECT, sessionId: 's-2' });
  });
});
