import { bind, TRACKER_CONTRACT, TRACKER_READS_CONTRACT } from '../../../conformance/index.ts';
import { connectorDeps, portsOf } from '../../../testing/adapter-deps.ts';
import { describeContracts } from '../../../testing/contracts.ts';
import { FakeCredentials } from '../../../testing/fake-credentials.ts';
import { JiraWorld } from '../../../testing/jira-world.ts';
import { readsPortOf } from '../../../testing/reads-port.ts';
import adapter from './index.ts';
import { declaration } from './declaration.ts';
import type { JiraTracker } from './tracker.ts';

/**
 * The adapter built through its own entry over a fake Jira, its config section naming the project, with the stamp
 * footer off: the cases read back the exact text they sent.
 */
function trackerOver(jira: JiraWorld): JiraTracker {
  const deps = connectorDeps({ http: jira, credentials: new FakeCredentials().saves('teamrig-jira-acme', 'someone@example.com:the-token'), stamp: false });
  return portsOf(adapter, deps, { site: 'acme', projects: ['ENG'] }).tracker;
}

describeContracts({
  side: 'connector',
  declaration,
  bound: [
    bind({
      contract: TRACKER_CONTRACT,
      make: () => {
        const jira = new JiraWorld('acme', 'ENG');
        return { port: trackerOver(jira), world: jira.world() };
      },
      without: {
        'tracker.label-exists-tells-each':
          'a Jira label exists once an issue carries it, so the tracker answers found for any name Jira can hold: the manifest says so of tracker.labels',
      },
    }),
    bind({
      contract: TRACKER_READS_CONTRACT,
      make: () => {
        const jira = new JiraWorld('acme', 'ENG');
        return { port: readsPortOf(trackerOver(jira)), world: jira.readsWorld() };
      },
    }),
  ],
});
