import { isRecord } from "../core/guards.js";
/** The most account ids one matcher names. */
export const MAX_TRUST_ACCOUNTS = 100;
/** The matcher kinds the model has (trust-rule.ts) that no connector reads yet: named so the refusal says "not yet". */
const LATER_KINDS = new Set(['groups', 'projectRoles', 'emailDomains', 'anonymous']);
const LEVEL_KEYS = new Set(['inside', 'never', 'edits']);
const SITE_KEYS = new Set([...LEVEL_KEYS, 'projects']);
/** Keys a later slice reads, refused with what to do meanwhile rather than read as a silent no-op. */
const LATER_KEYS = new Map([
    ['accept', 'is not read yet: an outsider issue imports only by inside, so drop the key'],
    ['import', 'is not read yet: to read nothing of a project, leave it out of the connector\'s projects'],
]);
/** The rule of a section with no `trust` key: every key takes the connector's default. */
export const NO_TRUST_RULE = { inside: undefined, never: [], edits: undefined, projects: new Map() };
function shown(value) {
    return JSON.stringify(value);
}
function listOf(value, key, report, check) {
    if (!Array.isArray(value) || value.length === 0) {
        report(key, 'must be a list of one or more names');
        return undefined;
    }
    const out = [];
    let failed = false;
    value.forEach((entry, index) => {
        const at = `${key}[${index}]`;
        const text = typeof entry === 'string' ? entry.trim() : '';
        const problem = typeof entry === 'string' ? check(text, at) : `must be text, not ${shown(entry)}`;
        if (problem !== undefined) {
            report(at, problem);
            failed = true;
        }
        else if (out.includes(text)) {
            report(at, `names ${text} a second time`);
        }
        else {
            out.push(text);
        }
    });
    if (out.length > MAX_TRUST_ACCOUNTS) {
        report(key, `names more than the ${MAX_TRUST_ACCOUNTS} the rule takes`);
        return undefined;
    }
    return failed ? undefined : out;
}
function matcherOf(value, key, syntax, report) {
    const kinds = isRecord(value) ? Object.keys(value) : [];
    const kind = kinds[0];
    if (!isRecord(value) || kind === undefined || kinds.length !== 1) {
        report(key, `must be one matcher, {"accountType": [...]} or {"accounts": [...]}, not ${shown(value)}`);
        return undefined;
    }
    if (kind === 'accountType') {
        const types = listOf(value[kind], `${key}.accountType`, report, (entry) => syntax.accountTypes.includes(entry) ? undefined : `must be one of ${syntax.accountTypes.join(', ')}, not ${shown(entry)}`);
        return types === undefined ? undefined : { kind, types };
    }
    if (kind === 'accounts') {
        const ids = listOf(value[kind], `${key}.accounts`, report, (entry) => (syntax.accountId.test(entry) ? undefined : `must be an account id, not ${shown(entry)}`));
        return ids === undefined ? undefined : { kind, ids };
    }
    report(key, LATER_KINDS.has(kind) ? `${kind} is not read by this connector yet; name accountType or accounts` : `has no matcher ${shown(kind)}; name accountType or accounts`);
    return undefined;
}
/**
 * A list of matchers. An `inside` with a wrong entry reads as an empty list (nothing is inside): reading it as left out
 * would fall back to the default, which may be wider than what the team wrote. A wrong `never` entry is dropped alone.
 */
function matchersOf(value, key, syntax, report, widens) {
    if (!Array.isArray(value)) {
        report(key, 'must be a list of matchers ([{"accountType": ["atlassian"]}])');
        return [];
    }
    const matchers = value.map((entry, index) => matcherOf(entry, `${key}[${index}]`, syntax, report));
    const read = matchers.flatMap((matcher) => (matcher === undefined ? [] : [matcher]));
    return widens && read.length !== matchers.length ? [] : read;
}
function editsOf(value, key, report) {
    if (value === undefined || value === 'inside' || value === 'any') {
        return value;
    }
    report(key, `must be "inside" or "any", not ${shown(value)}`);
    return 'inside';
}
function unknownKeys(value, known, key, report) {
    for (const name of Object.keys(value)) {
        const later = LATER_KEYS.get(name);
        if (later !== undefined) {
            report(`${key}.${name}`, later);
        }
        else if (!known.has(name)) {
            report(`${key}.${name}`, `is no key of a trust rule (${[...known].join(', ')})`);
        }
    }
}
function levelOf(value, key, syntax, report) {
    return {
        inside: value['inside'] === undefined ? undefined : matchersOf(value['inside'], `${key}.inside`, syntax, report, true),
        never: value['never'] === undefined ? [] : matchersOf(value['never'], `${key}.never`, syntax, report, false),
        edits: editsOf(value['edits'], `${key}.edits`, report),
    };
}
function projectOf(value, key, syntax, report) {
    if (!isRecord(value)) {
        report(key, `must be an object of a project's own rule, not ${shown(value)}`);
        return undefined;
    }
    unknownKeys(value, LEVEL_KEYS, key, report);
    return levelOf(value, key, syntax, report);
}
function projectsOf(value, key, syntax, report) {
    const projects = new Map();
    if (value === undefined) {
        return projects;
    }
    if (!isRecord(value)) {
        report(key, 'must be an object of project keys to their own rule ({"ENG": {"edits": "any"}})');
        return projects;
    }
    for (const [name, rule] of Object.entries(value)) {
        const project = syntax.projectKey(name.trim());
        const read = project === undefined ? undefined : projectOf(rule, `${key}.${project}`, syntax, report);
        if (project === undefined) {
            report(`${key}.${name}`, `must be a project key, not ${shown(name)}`);
        }
        else if (read !== undefined) {
            projects.set(project, read);
        }
    }
    return projects;
}
/** The rule a connector section's `trust` value holds, `key` naming it in each report line. */
export function parseTrustRule(value, key, syntax, report) {
    if (value === undefined) {
        return NO_TRUST_RULE;
    }
    if (!isRecord(value)) {
        report(key, `must be an object (inside, never, edits, projects), not ${shown(value)}`);
        return { ...NO_TRUST_RULE, inside: [] };
    }
    unknownKeys(value, SITE_KEYS, key, report);
    return { ...levelOf(value, key, syntax, report), projects: projectsOf(value['projects'], `${key}.projects`, syntax, report) };
}
