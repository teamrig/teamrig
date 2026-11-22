import { declaration } from "./declaration.js";
import { browseUrl, issueKey, issueNumber, parseProject, projectKey } from "./site.js";
/** An issue key as a ref holds it, in capitals: the project key, a dash, the issue's number. */
const KEY = /^([A-Z][A-Z0-9_]*)-([1-9][0-9]{0,9})$/;
/**
 * The refs of a Jira site's issues: `jira:ENG-12`, the issue key as Jira prints it. The site is not in the ref: a team
 * works on one site (`connectors.jira.site`), so a ref reads as an issue of that site, and an issue of another site
 * has no ref. With no site named, no ref is read or written.
 */
export function jiraRefs(site) {
    /** The project `target` sits in, when it is one of the named site's. */
    const projectOf = (target) => {
        const project = parseProject(target.repo);
        return project === undefined || project.site !== site ? undefined : project;
    };
    return {
        refOf: (target) => {
            const project = projectOf(target);
            return project === undefined ? undefined : `${declaration.refPrefix}${issueKey(project, target.number)}`;
        },
        pageOf: (target) => {
            const project = projectOf(target);
            return project === undefined ? undefined : browseUrl(project, target.number);
        },
        parseRef: (ref) => {
            const key = ref.startsWith(declaration.refPrefix) ? KEY.exec(ref.slice(declaration.refPrefix.length)) : null;
            const project = key?.[1] === undefined ? undefined : projectKey(key[1]);
            if (site === undefined || key === null || project === undefined) {
                return undefined;
            }
            const number = issueNumber({ site, key: project }, key[0]);
            return number === undefined ? undefined : { repo: `${site}/${project.toLowerCase()}`, number };
        },
    };
}
