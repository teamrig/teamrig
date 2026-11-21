import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CREDENTIAL_VARIABLES, dispatchedEnvOf, PARKED_VARIABLES, parkedEnvOf, withoutCredentials } from './child-env.ts';

const VALUE = 'not-a-real-credential';
/** What a host port names: every variable it sets for a session, and those of them a parked step keeps. */
const HOST_SESSION = ['AGENT_RUN', 'AGENT_SESSION', 'AGENT_SOCKET', 'AGENT_SOCKET_TOKEN', 'AGENT_ROOT'];
const HOST_PARKED = ['AGENT_RUN', 'AGENT_SESSION', 'AGENT_ROOT'];

describe('withoutCredentials', () => {
  it('leaves every credential variable out and keeps the rest as they were', () => {
    const credentials = Object.fromEntries(CREDENTIAL_VARIABLES.map((name) => [name, VALUE]));
    assert.deepEqual(withoutCredentials({ ...credentials, PATH: '/usr/bin', TERM: 'xterm', NPM_CONFIG_CACHE: '/cache' }, []), {
      PATH: '/usr/bin',
      TERM: 'xterm',
      NPM_CONFIG_CACHE: '/cache',
    });
  });

  it('compares names without case, as Windows reads them', () => {
    assert.deepEqual(withoutCredentials({ gh_token: VALUE, Github_Token: VALUE, Path: 'C:/Windows' }, []), { Path: 'C:/Windows' });
  });

  it('keeps the credential variables pass names, in any case', () => {
    assert.deepEqual(withoutCredentials({ NPM_TOKEN: VALUE, GH_TOKEN: VALUE, PATH: '/usr/bin' }, ['npm_token']), { NPM_TOKEN: VALUE, PATH: '/usr/bin' });
  });
});

describe('parkedEnvOf (T4093)', () => {
  it('keeps only the allow-listed and teamrig variables, in any case, so an unknown secret never reaches disk', () => {
    const credentials = Object.fromEntries(CREDENTIAL_VARIABLES.map((name) => [name, VALUE]));
    const env = { ...credentials, Path: 'C:/Windows', TEMP: 'C:/Temp', TEAMRIG_SESSION: 'alpha', teamrig_team: 'kit', MY_DB_PASSWORD: VALUE, NPM_CONFIG__AUTHTOKEN: VALUE, GIT_CONFIG_PARAMETERS: VALUE };
    assert.deepEqual(parkedEnvOf(env, []), { Path: 'C:/Windows', TEMP: 'C:/Temp', TEAMRIG_SESSION: 'alpha', teamrig_team: 'kit' });
  });

  it('lists no credential variable', () => {
    assert.ok(PARKED_VARIABLES.every((name) => !CREDENTIAL_VARIABLES.includes(name)));
  });

  it('keeps the session variables its host lets a parked step keep, in any case, and no other of the session', () => {
    const env = { PATH: '/usr/bin', AGENT_RUN: '1', agent_session: 's-1', AGENT_ROOT: '/work/app', AGENT_SOCKET: '/run/agent', AGENT_SOCKET_TOKEN: VALUE };
    assert.deepEqual(parkedEnvOf(env, HOST_PARKED), { PATH: '/usr/bin', AGENT_RUN: '1', agent_session: 's-1', AGENT_ROOT: '/work/app' });
    assert.deepEqual(parkedEnvOf(env, ['agent_run']), { PATH: '/usr/bin', AGENT_RUN: '1' });
    assert.deepEqual(parkedEnvOf(env, []), { PATH: '/usr/bin' });
  });

  it('never keeps a credential variable, whatever a host names as kept', () => {
    const credentials = Object.fromEntries(CREDENTIAL_VARIABLES.map((name) => [name, VALUE]));
    assert.deepEqual(parkedEnvOf({ ...credentials, gh_token: VALUE, AGENT_RUN: '1' }, [...CREDENTIAL_VARIABLES, 'AGENT_RUN']), { AGENT_RUN: '1' });
  });
});

describe('dispatchedEnvOf (T4093)', () => {
  it("runs a step with the dispatcher's environment under its parked variables, credentials kept", () => {
    const dispatcher = { PATH: '/dispatcher/bin', GH_TOKEN: VALUE, JAVA_HOME: '/jdk' };
    assert.deepEqual(dispatchedEnvOf(dispatcher, { PATH: '/step/bin', TEAMRIG_SESSION: 'alpha' }, HOST_SESSION), { PATH: '/step/bin', GH_TOKEN: VALUE, JAVA_HOME: '/jdk', TEAMRIG_SESSION: 'alpha' });
  });

  it("never gives a step the dispatcher's teamrig variables, nor a second copy of a name in another case", () => {
    const dispatcher = { TEAMRIG_SESSION: 'beta', TEAMRIG_HOST_LOCK: 'lock-1', Path: '/dispatcher/bin' };
    assert.deepEqual(dispatchedEnvOf(dispatcher, { PATH: '/step/bin' }, []), { PATH: '/step/bin' });
  });

  it("runs a step as its parker's session of the host, never the dispatcher's, and without what the host keeps off disk", () => {
    const sessionOf = (id: string): Record<string, string> => Object.fromEntries(HOST_SESSION.map((name) => [name, name === 'AGENT_SOCKET_TOKEN' ? VALUE : `${id}-${name}`]));
    const dispatcher = { ...sessionOf('a'), PATH: '/dispatcher/bin' };
    const parker = { ...sessionOf('b'), PATH: '/step/bin' };
    assert.deepEqual(dispatchedEnvOf(dispatcher, parkedEnvOf(parker, HOST_PARKED), HOST_SESSION), {
      PATH: '/step/bin',
      AGENT_RUN: 'b-AGENT_RUN',
      AGENT_SESSION: 'b-AGENT_SESSION',
      AGENT_ROOT: 'b-AGENT_ROOT',
    });
  });

  it("leaves the dispatcher's session variables out in any case, and those of a person's own step too: it parked none", () => {
    const dispatcher = { agent_run: '1', Agent_Socket: '/run/agent', PATH: '/dispatcher/bin' };
    assert.deepEqual(dispatchedEnvOf(dispatcher, { PATH: '/step/bin' }, ['AGENT_RUN', 'agent_socket']), { PATH: '/step/bin' });
  });
});
