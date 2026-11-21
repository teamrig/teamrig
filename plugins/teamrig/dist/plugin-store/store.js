/** The most folders of the installs one look at the store reads, so a large install keeps the look bounded. */
export const STORE_FOLDERS_MAX = 500;
/** The folder that holds a path: what comes before its last `/` or `\`. */
export function parentOf(path) {
    const trimmed = path.replace(/[\\/]+$/, '');
    const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return cut <= 0 ? trimmed : trimmed.slice(0, cut);
}
/**
 * The newest of `times` less than `windowMs` from `now` either way: a time a little ahead of the clock is a change
 * now, while one far ahead (the clock set back since) never holds a wait for good. Undefined when none is.
 */
export function newestNear(times, now, windowMs) {
    const near = times.filter((time) => Math.abs(now - time) < windowMs);
    return near.length === 0 ? undefined : Math.max(...near);
}
/**
 * When each part of the store an install writes last changed, in milliseconds since the epoch: the store's list
 * files at `listFiles` (the plugin list and the marketplace list), and for each of `installs` its plugin's folder (a
 * version added or removed) and every folder of the install, breadth first, up to STORE_FOLDERS_MAX; a missing one is
 * left out (its plugin's folder dates a removal). Claude Code's `claude plugin update` creates the new version's
 * folder, copies the plugin into it and names it in the plugin list before the copy ends, and a copied file keeps its
 * source's time, so only the folders date the copy. A reload while it runs loads part of the plugin: on 10-19 one ran
 * 0.4 s into teamrig's copy and left a tab without teamrig's hooks for 15 hours (T561).
 */
export async function storeTimesOf(store, listFiles, installs) {
    const folders = installs.map((install) => parentOf(install.installPath));
    let level = installs.map((install) => install.installPath);
    let budget = STORE_FOLDERS_MAX;
    while (level.length > 0 && budget > 0) {
        const taken = level.slice(0, budget);
        budget -= taken.length;
        folders.push(...taken);
        level = budget > 0 ? (await Promise.all(taken.map((folder) => store.foldersIn(folder)))).flat() : [];
    }
    const paths = [...new Set([...listFiles, ...folders])];
    const times = await Promise.all(paths.map((path) => store.changedAt(path)));
    return times.filter((time) => time !== undefined);
}
