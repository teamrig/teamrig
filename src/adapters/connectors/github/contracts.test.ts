import { bind, TRACKER_CONTRACT, TRACKER_READS_CONTRACT } from '../../../conformance/index.ts';
import { connectorDeps, portsOf } from '../../../testing/adapter-deps.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { FakeCredentials, TEST_OWNERS } from '../../../testing/fake-credentials.ts';
import { GitHubWorld } from '../../../testing/github-world.ts';
import { programOverGh } from '../../../testing/program-over-gh.ts';
import { readsPortOf } from '../../../testing/reads-port.ts';
import adapter from './index.ts';
import { declaration } from './declaration.ts';
import type { GitHubIssueHost } from './host.ts';

/**
 * The adapter built through its own entry over a fake GitHub, so gh's allowlist of command lines (gh.ts) is held to
 * the cases too. The stamp footer is off: the cases read back the exact body they sent.
 */
function trackerOver(github: GitHubWorld): GitHubIssueHost {
  return portsOf(adapter, connectorDeps({ run: programOverGh(github), credentials: new FakeCredentials().savesTokensFor(TEST_OWNERS), stamp: false })).tracker;
}

describeContracts({
  side: 'connector',
  declaration,
  bound: [
    bind({
      contract: TRACKER_CONTRACT,
      make: () => {
        const github = new GitHubWorld('acme/web');
        return { port: trackerOver(github), world: github.world() };
      },
    }),
    bind({
      contract: TRACKER_READS_CONTRACT,
      make: () => {
        const github = new GitHubWorld('acme/web');
        return { port: readsPortOf(trackerOver(github)), world: github.readsWorld() };
      },
    }),
  ],
});
