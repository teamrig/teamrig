import { isUnsupported, type HostModels } from '../ports/host/index.ts';
import { quietWorld } from './quiet-world.ts';

/**
 * The shipped host's models, as a quiet world's run carries them: a spec of code that checks a model name, the lead's
 * default or a switch step asks here, never an adapter's own file. A host that knows none fails the spec with its
 * reason.
 */
export function shippedModels(): HostModels {
  const { models } = quietWorld().host({ env: {}, platform: 'linux' });
  if (isUnsupported(models)) {
    throw new Error(`the shipped host knows no models: ${models.notice}`);
  }
  return models;
}
