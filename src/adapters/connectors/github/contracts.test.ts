import { bind, TRACKER_CONTRACT } from '../../../conformance/index.ts';
import { connectorDeps, portsOf } from '../../../testing/adapter-deps.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { FakeCredentials, TEST_OWNERS } from '../../../testing/fake-credentials.ts';
import { GitHubWorld } from '../../../testing/github-world.ts';
import { programOverGh } from '../../../testing/program-over-gh.ts';
import adapter from './index.ts';
import { declaration } from './declaration.ts';

describeContracts({
  side: 'connector',
  declaration,
  bound: [
    bind({
      contract: TRACKER_CONTRACT,
      make: () => {
        const github = new GitHubWorld('acme/web');
        // Built through the adapter's own entry, so gh's allowlist of command lines (gh.ts) is held to the cases too.
        // The stamp footer is off: the cases read back the exact body they sent.
        const ports = portsOf(adapter, connectorDeps({ run: programOverGh(github), credentials: new FakeCredentials().savesTokensFor(TEST_OWNERS), stamp: false }));
        return { port: ports.tracker, world: github.world() };
      },
    }),
  ],
});
