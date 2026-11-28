import { somePositionals, UsageError } from "../args.js";
/**
 * The members a hook set's command line names (`hook guards <guard> ...`, `hook after <hook> ...`), in its order, each
 * once, with what the set runs for each; a name of no member, or one named twice, is a usage error. `noun` is what the
 * set calls a member in that error.
 */
export function membersNamed(args, members, noun) {
    const names = somePositionals(args, noun);
    const unknown = names.find((name) => !members.has(name));
    if (unknown !== undefined) {
        throw new UsageError(`no ${noun} named "${unknown}" runs in a set; the set's ${noun}s are ${[...members.keys()].join(', ')}`);
    }
    if (new Set(names).size !== names.length) {
        throw new UsageError(`a ${noun} is named twice`);
    }
    return names.flatMap((name) => {
        const member = members.get(name);
        return member === undefined ? [] : [[name, member]];
    });
}
