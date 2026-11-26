/**
 * A tracker's trust rule as the team's config writes it (T4928): which authors' issues may become tasks as written.
 * The core evaluates it, so every connector that reads one gives it the same meaning. Only `inside` adds trust; only
 * `never` and `edits` take it away; nothing reads trust from the issue's own text.
 */
/**
 * The rule of `project`, its overrides on top of the site's. `publicProject` is true unless the tracker proved the
 * project closed to anonymous readers: the default `inside` is then not applied, only one a team wrote. `insideKey` is
 * the config key the guard's line names.
 */
export function resolveTrust(site, project, defaults, publicProject, insideKey) {
    const own = site.projects.get(project);
    const written = own?.inside ?? site.inside;
    const never = [...site.never, ...(own?.never ?? [])];
    const edits = own?.edits ?? site.edits ?? defaults.edits;
    if (written !== undefined) {
        return { inside: written, never, edits, heldDefault: undefined };
    }
    return publicProject ? { inside: [], never, edits, heldDefault: insideKey } : { inside: defaults.inside, never, edits, heldDefault: undefined };
}
/** Whether `author` matches `matcher`; an author fact the tracker did not give never matches (fail closed). */
export function matches(matcher, author) {
    if (matcher.kind === 'accounts') {
        return author.accountId !== '' && matcher.ids.includes(author.accountId);
    }
    return author.accountType !== undefined && matcher.types.includes(author.accountType);
}
/** How a matcher reads in a preview line: `accountType atlassian`, `accounts <id>`. */
export function matcherText(matcher) {
    return matcher.kind === 'accounts' ? `accounts ${matcher.ids.join(',')}` : `accountType ${matcher.types.join(',')}`;
}
function isInside(rule, author) {
    return !rule.never.some((matcher) => matches(matcher, author)) && rule.inside.some((matcher) => matches(matcher, author));
}
function untrusted(why, failed) {
    return { trusted: false, why, failed };
}
/** Whether an issue with these facts may become a task as written under `rule`, and why. */
export function judgeTrust(rule, facts) {
    const author = facts.author;
    if (author === undefined || author.accountId === '') {
        return untrusted('the reporter is anonymous or hidden');
    }
    const never = rule.never.find((matcher) => matches(matcher, author));
    if (never !== undefined) {
        return untrusted(`the reporter matches never (${matcherText(never)})`);
    }
    const inside = rule.inside.find((matcher) => matches(matcher, author));
    if (inside === undefined) {
        if (rule.heldDefault !== undefined) {
            return untrusted(`anyone may browse the project, so the default inside is not applied; set ${rule.heldDefault}`);
        }
        return untrusted(`the reporter (${author.accountType ?? 'unknown'} account) matches no inside`);
    }
    if (rule.edits === 'inside') {
        if (facts.editors.kind === 'unread') {
            return untrusted('its edit history could not be read whole', facts.editors.why);
        }
        const outsider = facts.editors.editors.find((editor) => !isInside(rule, editor));
        if (outsider !== undefined) {
            return untrusted(`its title or body was edited by ${outsider.accountId === '' ? 'an anonymous account' : outsider.accountId}, who is not inside`);
        }
    }
    return { trusted: true, why: `the reporter matches inside (${matcherText(inside)})` };
}
