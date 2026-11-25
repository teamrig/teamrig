import { repoGlobsOf } from '../../src/cli/host.ts';
import { HOST_PROGRAM_TIMEOUT_MS, loadHostPorts, loadShippedHosts } from '../../src/composition/host-ports.ts';
import { nodeProgramRunner } from '../../src/core/program-runner.ts';
import type { HostGlobs } from './approval.ts';

/**
 * The real `HostGlobs` (T3448): loads every host adapter teamrig ships with and the one this process runs in, as the
 * CLI does at its start, and reads their repository globs in this process's environment. It loads them on the first
 * call and keeps the answer, so a merge that never reaches the answerer's clearance loads no adapter.
 */
export function shippedHostGlobs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): HostGlobs {
  let globs: Promise<readonly string[]> | undefined;
  return () => {
    globs ??= (async () => {
      const run = nodeProgramRunner(HOST_PROGRAM_TIMEOUT_MS);
      const [host, shippedHosts] = await Promise.all([loadHostPorts(run), loadShippedHosts(run)]);
      return repoGlobsOf({ host, shippedHosts, env, platform });
    })();
    return globs;
  };
}
