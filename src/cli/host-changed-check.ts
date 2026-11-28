import type { HostPinChange } from '../composition/terminal-host-pins.ts';
import type { TerminalHostPin } from '../config/types.ts';
import type { UnownedWarning } from './unowned.ts';

/**
 * HOST-CHANGED, for `check`: each outside terminal host of the team whose files no longer match the pin the owner set.
 * teamrig runs no such host, and a new pin is the owner's act, so it goes to the lead, who takes it to the owner. Its
 * key names the host, so the lead is told once while it stands. Reads only; a team that pins no host reads nothing.
 */
export async function hostChangedWarnings(hosts: Readonly<Record<string, TerminalHostPin>>, changeOf: HostPinChange): Promise<UnownedWarning[]> {
  const warnings: UnownedWarning[] = [];
  for (const [name, pin] of Object.entries(hosts)) {
    const change = await changeOf(pin);
    if (change !== undefined) {
      const text =
        `HOST-CHANGED ${name}: its files no longer match the pin (${change}). It gets no requests and its sessions get no wakes ` +
        `until the owner pins it again in terminalHosts.${name}`;
      warnings.push({ key: `host-changed ${name}`, source: 'the terminal host check [terminalHosts]', text });
    }
  }
  return warnings;
}
