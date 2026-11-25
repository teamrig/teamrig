import { DEFAULT_HOST } from '../composition/adapters.ts';
import type { ShippedHosts } from '../composition/host-ports.ts';
import type { ProgramRequest, ProgramResult, ProgramRunner } from '../core/program-runner.ts';
import { isUnsupported, type WakeDelivery } from '../ports/host/index.ts';
import { SHIPPED_HOST, shippedHost } from './host.ts';

/** The host id a spec runs a session in to wake it through its program, as Codex CLI is (src/cli/host-wake.ts). */
export const WAKING_HOST = 'codex-cli';

/** The program the waking host's sessions are woken through, found on PATH `/bin`. */
export const WAKING_PROGRAM = '/bin/codex';

const OK: ProgramResult = { end: { kind: 'exited', code: 0 }, stdout: '', stderr: '' };

/** The default host beside WAKING_HOST, whose launcher wakes a session by `codex wake <session> <text>` and reads `delivery` from each run. */
export function wakingHosts(delivery: WakeDelivery = { kind: 'delivered' }): ShippedHosts {
  const waking = shippedHost((given) => {
    const ports = SHIPPED_HOST(given);
    const { launcher } = ports;
    if (isUnsupported(launcher)) {
      throw new Error('the shipped host tells nothing of its sessions');
    }
    return { ...ports, launcher: { ...launcher, program: 'codex', wake: { args: (session, text) => ['wake', session, text], outcome: () => delivery } } };
  });
  return { [DEFAULT_HOST]: shippedHost(SHIPPED_HOST), [WAKING_HOST]: waking };
}

/** A program runner that keeps each request in `runs` and answers it with a clean exit. */
export function recordingRunner(runs: ProgramRequest[]): ProgramRunner {
  return async (request) => {
    runs.push(request);
    return OK;
  };
}

/** A program runner that throws `message` at each request, as one whose program could not start does. */
export function failingRunner(message: string): ProgramRunner {
  return async () => {
    throw new Error(message);
  };
}
