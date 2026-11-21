import type { CliRuntime } from '../cli/runtime.ts';
import { FakeCheckout } from './fake-checkout.ts';
import { FakeExecSpawner } from './fake-exec-spawner.ts';
import { FakeHooks } from './fake-hooks.ts';
import { FakeHostCpu } from './fake-host-cpu.ts';
import { FakeHostMemory } from './fake-host-memory.ts';
import { FakeStarterWatch } from './fake-starter-watch.ts';
import { FakeSteps } from './fake-steps.ts';

/** What delivery runs and admits: queued steps, the memory and CPU their admission reads, deploys and `teamrig exec`. */
export type DeliveryWorld = Pick<CliRuntime, 'steps' | 'memory' | 'cpu' | 'starters' | 'hooks' | 'exec'>;

/**
 * The MB free on a quiet host: over the default floor plus a heavy step's reserve, so no step waits on the memory
 * gate; a spec that tests a memory wait sets less.
 */
export const ROOMY_FREE_MB = 16_000;

/**
 * Delivery when a run does not care about it: a queued step and each program a deploy runs exit 0 at once while the
 * shell that started it runs on, the host has room in memory for any queued step (`ROOMY_FREE_MB` free) and an idle
 * CPU, and a privileged command `teamrig exec` runs exits 0 in a clean checkout of the fixture request's repository
 * (testing/fake-checkout.ts).
 */
export function quietDelivery(): DeliveryWorld {
  return {
    steps: new FakeSteps(),
    memory: new FakeHostMemory(ROOMY_FREE_MB),
    cpu: new FakeHostCpu(),
    starters: new FakeStarterWatch(),
    hooks: new FakeHooks(),
    exec: { spawner: new FakeExecSpawner(), checkout: new FakeCheckout() },
  };
}
