import { isUnsupported, type HostSteps } from '../ports/host/index.ts';
import { quietWorld } from './quiet-world.ts';

/**
 * The shipped host's steps, as a quiet world's run carries them: a spec of a notice that names a step the person
 * types asks here, never an adapter's own file. A host that knows none fails the spec with its reason.
 */
export function shippedSteps(): HostSteps {
  const { steps } = quietWorld().host({ env: {}, platform: 'linux' });
  if (isUnsupported(steps)) {
    throw new Error(`the shipped host knows no steps: ${steps.notice}`);
  }
  return steps;
}
