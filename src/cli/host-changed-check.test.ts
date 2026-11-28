import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TerminalHostPin } from '../config/types.ts';
import { hostChangedWarnings } from './host-changed-check.ts';

const PIN: TerminalHostPin = { path: '/opt/term/host', sha256: 'a'.repeat(64), args: [] };

describe('hostChangedWarnings', () => {
  it('reads nothing for a team that pins no host', async () => {
    assert.deepEqual(await hostChangedWarnings({}, () => Promise.reject(new Error('read'))), []);
  });

  it('warns of nothing while every host matches its pin', async () => {
    assert.deepEqual(await hostChangedWarnings({ term: PIN }, async () => undefined), []);
  });

  it('warns the lead once per changed host, with what differs and whose act the new pin is', async () => {
    const other: TerminalHostPin = { path: '/opt/other/host', sha256: PIN.sha256, args: [] };
    const warnings = await hostChangedWarnings({ term: PIN, other }, async (pin) => (pin === PIN ? 'pinned sha256 aaaa…aaaa; found sha256 bbbb…bbbb' : undefined));
    assert.deepEqual(warnings, [
      {
        key: 'host-changed term',
        source: 'the terminal host check [terminalHosts]',
        text: 'HOST-CHANGED term: its files no longer match the pin (pinned sha256 aaaa…aaaa; found sha256 bbbb…bbbb). It gets no requests and its sessions get no wakes until the owner pins it again in terminalHosts.term',
      },
    ]);
  });
});
