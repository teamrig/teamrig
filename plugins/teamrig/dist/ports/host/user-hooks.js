/** Counts inserted, unchanged, changed, and removed handlers between two keyed maps of JSON-encoded handlers. */
export function userHooksCounts(before, after) {
    let inserted = 0;
    let unchanged = 0;
    let changed = 0;
    for (const [key, handler] of after) {
        const old = before.get(key);
        if (old === undefined)
            inserted += 1;
        else if (old === handler)
            unchanged += 1;
        else
            changed += 1;
    }
    const removed = [...before.keys()].filter((key) => !after.has(key)).length;
    return { inserted, unchanged, changed, removed };
}
/** Formats a skipped handler for `setup hooks` output. */
export function skippedUserHookLine(skipped) {
    const where = skipped.matcher === undefined ? skipped.event : `${skipped.event} (${skipped.matcher})`;
    return `${where}: ${skipped.words.join(' ')}: ${skipped.reason}`;
}
