import { setTimeout as sleep } from 'node:timers/promises';
import { defineConnector } from "../../../plugin-api/index.js";
import { JiraClient } from "./client.js";
import { parseJiraConfig } from "./config.js";
import { declaration } from "./declaration.js";
import { jiraRefs } from "./refs.js";
import { JiraTracker } from "./tracker.js";
/** The tracker's place of each project the section names, `<site>/<key>` in lowercase; none while it names no site. */
function targetsOf(config) {
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
