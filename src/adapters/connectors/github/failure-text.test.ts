import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rerunFailureText, writeFailureText } from './host.ts';
import type { RepoAccess } from './tokens.ts';

const TOKEN: RepoAccess = { env: { HOME: '/u', GH_TOKEN: 'write-token' }, owner: 'acme', scope: 'acme', credential: 'teamrig-gh-acme', save: 'save teamrig-gh-acme' };
const OFFLINE = 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n';
const NOT_REFUSED = /^gh did not reach GitHub \(the network is off where it ran, as in a sandbox without it, or GitHub is down\): the token saved as teamrig-gh-acme was not refused/;

describe('a GitHub write or re-run that never reached GitHub (#2281)', () => {
  it('says the network failed, never that the token was refused', () => {
    assert.match(writeFailureText({ repo: 'acme/web', number: 7 }, 'comment on', 1, OFFLINE, TOKEN), NOT_REFUSED);
    assert.match(rerunFailureText('acme/web', 42, 1, OFFLINE, TOKEN), NOT_REFUSED);
  });

  it('still reads a refused token as one', () => {
    assert.match(writeFailureText({ repo: 'acme/web', number: 7 }, 'comment on', 1, 'HTTP 401: Bad credentials\n', TOKEN), /^GitHub refused the token saved as teamrig-gh-acme/);
  });
});
