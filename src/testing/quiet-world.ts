import type { CliRuntime } from '../cli/runtime.ts';
import { quietDelivery, type DeliveryWorld } from './quiet-delivery.ts';
import { quietGit, type GitWorld } from './quiet-git.ts';
import { quietHost, type HostWorld } from './quiet-host.ts';
import { quietServices, type ServicesWorld } from './quiet-services.ts';

/**
 * The parts of a CLI run that reach outside the kit, one area per file: a new port's fake goes in its area's file
 * (quiet-git, quiet-host, quiet-delivery, quiet-services), so ports of different areas never edit the same lines.
 */
export type OutsideWorld = GitWorld & HostWorld & DeliveryWorld & ServicesWorld & Pick<CliRuntime, 'newId'>;

/**
 * The outside world when a run does not care about it, each area quiet (see its file): the repo on `branch`, `stdin`
 * (default empty) on stdin, and new ids that count up: `id-1`, `id-2`.
 */
export function quietWorld(branch: string = 'dev', stdin: string = ''): OutsideWorld {
  let ids = 0;
  return {
    ...quietGit(branch),
    ...quietHost(stdin),
    ...quietDelivery(),
    ...quietServices(),
    newId: () => {
      ids += 1;
      return `id-${ids}`;
    },
  };
}
