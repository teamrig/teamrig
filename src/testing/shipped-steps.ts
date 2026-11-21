import type { HostSource } from '../composition/host-ports.ts';
import { isUnsupported, type HostSteps } from '../ports/host/index.ts';
import { bareHost } from './bare-host.ts';
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

/** The steps of a made-up host that types each one its own way: a spec shows a notice names the host's step, not a fixed one. */
export const OTHER_STEPS: HostSteps = {
  reloadPlugins: ':reload',
  exit: ':quit',
  pluginCommand: (name) => `:${name}`,
  resume: (id) => `other --continue ${id}`,
  updatePlugin: (plugin, marketplace) => `other plugins upgrade ${plugin} --from ${marketplace}`,
  updateHost: 'other upgrade',
};

/**
 * The shipped host with its steps taken away, the rest kept: a hook still runs there, so a spec sees how a notice
 * that names a step behaves on a host that names none.
 */
export function steplessHost(): HostSource {
  const { host } = quietWorld();
  return (seen) => ({ ...host(seen), steps: bareHost().steps });
}
