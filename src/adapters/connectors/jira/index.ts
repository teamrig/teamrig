import { setTimeout as sleep } from 'node:timers/promises';
import { defineConnector } from '../../../plugin-api/index.ts';
import { JiraClient } from './client.ts';
import { parseJiraConfig, type JiraConfig } from './config.ts';
import { declaration } from './declaration.ts';
import { jiraRefs } from './refs.ts';
import { JiraTracker } from './tracker.ts';

/** The tracker's place of each project the section names, `<site>/<key>` in lowercase; none while it names no site. */
function targetsOf(config: JiraConfig): readonly string[] {
  const { site } = config;
  return site === undefined ? [] : config.projects.map((key) => `${site}/${key.toLowerCase()}`);
}

/**
 * The Jira adapter: the tracker of a Jira Cloud project, reached over Jira's REST API with the credential saved for
 * its site, the targets its section names and the refs of that site's issues. Jira holds no code, so it builds no code host. A rate limit is waited
 * out on a real timer, stretched by chance so sessions limited together do not all return together.
 */
export default defineConnector({
  declaration,
  parseConfig: parseJiraConfig,
  create: (deps, config) => ({
    tracker: new JiraTracker(new JiraClient(deps.http, deps.credentials, deps.scanner, sleep, Math.random), deps.stamp, config),
    targets: targetsOf(config),
    refs: jiraRefs(config.site),
  }),
});
