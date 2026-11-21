import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hostSteps } from './steps.ts';

describe('Claude Code steps', () => {
  it('names its slash commands in a session', () => {
    assert.equal(hostSteps.reloadPlugins, '/reload-plugins');
    assert.equal(hostSteps.exit, '/exit');
    assert.equal(hostSteps.pluginCommand('teamrig'), '/teamrig');
  });

  it('names its claude program commands in a terminal', () => {
    assert.equal(hostSteps.resume('0f3c2a1b'), 'claude --resume 0f3c2a1b');
    assert.equal(hostSteps.updatePlugin('teamrig', 'teamrig'), 'claude plugin update teamrig@teamrig');
    assert.equal(hostSteps.updateHost, 'claude update');
  });
});
