import { isStringArray, parseTrustRule } from "../../../plugin-api/index.js";
import { isSite, projectKey } from "./site.js";
/** The section's keys, each beside the line the declaration says of it. */
export const CONFIG_KEYS = {
    site: "the Jira Cloud site's name, the part before .atlassian.net",
    projects: "the keys of the site's projects the team works in, as Jira spells them (ENG)",
    issueType: "the issue type a new issue opens as; without it a Task, or the project's first type that is no sub-task",
    people: "the account ids whose issues the import takes beside the signed-in account's own (sync.scope.assigned team)",
    trust: 'whose issues become tasks as written: inside, never and edits for the site, and projects for one project',
};
/** The account kinds Jira gives a reporter; a reporter with none is anonymous. */
export const ACCOUNT_TYPES = ['atlassian', 'customer', 'app'];
/**
 * A Jira Cloud account id: letters, digits, `:`, `_` and `-` (`5b10ac8d82e05b22cc7d4ef5`, `712020:2f6e…`). Held to
 * that shape, an id can be quoted into a search with nothing in it Jira would read as syntax.
 */
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
/** What a Jira trust rule may name: its account kinds, ids and project keys. */
const TRUST_SYNTAX = { accountTypes: ACCOUNT_TYPES, accountId: ACCOUNT_ID, projectKey };
/** The most account ids the section names, so a search's assignee clause stays a size Jira takes. */
export const MAX_PEOPLE = 100;
function shown(value) {
    return JSON.stringify(value);
}
function siteOf(value, report) {
    if (value === undefined) {
        return undefined;
    }
    const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (isSite(name)) {
        return name;
    }
    report('site', `must be the site's name, the part before .atlassian.net (acme for acme.atlassian.net), not ${shown(value)}`);
    return undefined;
}
function projectsOf(value, report) {
    if (value === undefined) {
        return [];
    }
    if (!isStringArray(value)) {
        report('projects', 'must be a list of project keys, as Jira spells them (["ENG"])');
        return [];
    }
    const keys = [];
    value.forEach((entry, index) => {
        const key = projectKey(entry.trim());
        if (key === undefined) {
            report(`projects[${index}]`, `must be a project key, a letter then letters, digits or _ (ENG), not ${shown(entry)}`);
        }
        else if (keys.includes(key)) {
            report(`projects[${index}]`, `names ${key} a second time`);
        }
        else {
            keys.push(key);
        }
    });
    return keys;
}
function issueTypeOf(value, report) {
    if (value === undefined) {
        return undefined;
    }
    const name = typeof value === 'string' ? value.trim() : '';
    if (name !== '' && !/[\r\n]/.test(name)) {
        return name;
    }
    report('issueType', `must be the name of an issue type on one line, as the project lists it (Task), not ${shown(value)}`);
    return undefined;
}
function peopleOf(value, report) {
    if (value === undefined) {
        return [];
    }
    if (!isStringArray(value)) {
        report('people', 'must be a list of Jira account ids (["5b10ac8d82e05b22cc7d4ef5"])');
        return [];
    }
    const ids = [];
    value.forEach((entry, index) => {
        const id = entry.trim();
        if (!ACCOUNT_ID.test(id)) {
            report(`people[${index}]`, `must be a Jira account id, letters, digits, :, _ or - (5b10ac8d82e05b22cc7d4ef5), not ${shown(entry)}`);
        }
        else if (ids.includes(id)) {
            report(`people[${index}]`, `names ${id} a second time`);
        }
        else if (ids.length === MAX_PEOPLE) {
            report(`people[${index}]`, `is past the ${MAX_PEOPLE} account ids the section may name`);
        }
        else {
            ids.push(id);
        }
    });
    return ids;
}
/**
 * Reads the section as the team's JSON holds it. Total: a wrong key is reported and reads as if it were left out.
 * A project is named by its key alone, so a section that lists projects and no site is reported too: nothing says
 * where they live.
 */
export function parseJiraConfig(section, report) {
    const site = siteOf(section['site'], report);
    const projects = projectsOf(section['projects'], report);
    if (section['site'] === undefined && projects.length > 0) {
        report('site', 'must name the site its projects live on');
    }
    return {
        site,
        projects,
        issueType: issueTypeOf(section['issueType'], report),
        people: peopleOf(section['people'], report),
        trust: parseTrustRule(section['trust'], 'trust', TRUST_SYNTAX, report),
    };
}
