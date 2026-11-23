/** Whether `value` holds a control character: a JQL string cannot hold one, and none belongs in a label or an account id. */
function hasControl(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || code === 0x7f) {
            return true;
        }
    }
    return false;
}
/**
 * `value` as a JQL string literal: in double quotes, each `\` and `"` escaped, so no value can end the string and
 * add a clause of its own. Undefined for a value holding a control character, which no JQL string can carry.
 */
export function jqlString(value) {
    return hasControl(value) ? undefined : `"${value.replace(/[\\"]/g, (found) => `\\${found}`)}"`;
}
function quotedAll(values, what) {
    const quoted = [];
    for (const value of values) {
        const literal = jqlString(value);
        if (literal === undefined) {
            return { kind: 'failed', reason: `the ${what} ${JSON.stringify(value)} cannot be searched in Jira: it holds a control character` };
        }
        quoted.push(literal);
    }
    return { kind: 'quoted', list: quoted.join(', ') };
}
/**
 * The JQL clause that asks for `scope`'s issues (never for `all`, which asks for no clause): assigned to the
 * signed-in account (`currentUser()`) or one of `people` when the scope takes the team's assignees, or carrying one
 * of its labels. Each value is quoted by jqlString, so a label or an id is only ever a value of the search.
 */
export function scopeClause(scope, people) {
    const parts = [];
    if (scope.assigned === 'team') {
        const ids = quotedAll([...new Set(people)], 'account id');
        if (ids.kind === 'failed') {
            return ids;
        }
        parts.push(`assignee in (${['currentUser()', ...(ids.list === '' ? [] : [ids.list])].join(', ')})`);
    }
    const labels = [...new Set(scope.labels)];
    if (labels.length > 0) {
        const quoted = quotedAll(labels, 'label');
        if (quoted.kind === 'failed') {
            return quoted;
        }
        parts.push(`labels in (${quoted.list})`);
    }
    return parts.length === 0 ? { kind: 'none' } : { kind: 'clause', jql: parts.join(' OR ') };
}
