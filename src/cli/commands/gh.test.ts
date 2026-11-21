import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CliHarness } from '../../testing/cli-harness.ts';
import { FakeCredentials } from '../../testing/fake-credentials.ts';
import { EXIT } from '../runtime.ts';

describe('teamrig gh', () => {
  it('refuses a line naming no gh command, reading no key', async () => {
    const credentials = new FakeCredentials();
    const result = await new CliHarness().run(['gh', '--'], { credentials });
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.join('\n'), /^REFUSED teamrig gh: it names no gh command/);
    assert.deepEqual(credentials.reads, []);
  });

  it('refuses a call whose owner has no saved key, naming the command that saves one, and never falls back to the login', async () => {
    const result = await new CliHarness().run(['gh', '--', 'issue', 'view', '12', '-R', 'acme/app'], { credentials: new FakeCredentials() });
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.join('\n'), /^REFUSED teamrig gh: no token for acme is saved as .+ save one with: /);
  });
});
