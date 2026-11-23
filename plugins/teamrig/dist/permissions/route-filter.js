/**
 * The read-only filter a sanctioned route's line may pipe into (T5070, security verdict T5072 F1): the right side of
 * `<route> | <filter>` reads only the pipe. Each filter takes a closed list of flags, no file operand and nothing that
 * follows a file or reads one the caller names, so a hook allow never reads past the host's Read deny rules.
 */
const COUNTED_LINES = { flags: { '-n': 'count', '-c': 'count' }, bareCount: true, operands: 0 };
/** The filters, by program word; never `-f`, `-F`, `--follow` or `--pid` (tail), `-r`, `-f` or `--include` (grep). */
export const ROUTE_FILTERS = {
    head: COUNTED_LINES,
    tail: COUNTED_LINES,
    grep: {
        flags: {
            '-i': 'switch',
            '-v': 'switch',
            '-n': 'switch',
            '-c': 'switch',
            '-E': 'switch',
            '-F': 'switch',
            '-w': 'switch',
            '-x': 'switch',
            '-o': 'switch',
            '-m': 'count',
            '-A': 'count',
            '-B': 'count',
            '-C': 'count',
        },
        bareCount: false,
        operands: 1,
    },
    wc: { flags: { '-l': 'switch', '-w': 'switch', '-c': 'switch', '-m': 'switch' }, bareCount: false, operands: 0 },
};
const COUNT = /^\d+$/;
const BARE_COUNT = /^-\d+$/;
/** True when `words` run one of {@link ROUTE_FILTERS} as written to read the pipe alone. */
export function isRouteFilter(words) {
    const [program, ...args] = words;
    const shape = program === undefined || !Object.hasOwn(ROUTE_FILTERS, program) ? undefined : ROUTE_FILTERS[program];
    if (shape === undefined) {
        return false;
    }
    let operands = 0;
    for (let at = 0; at < args.length; at += 1) {
        const word = args[at] ?? '';
        const flag = Object.hasOwn(shape.flags, word) ? shape.flags[word] : undefined;
        if (flag === 'count') {
            at += 1;
            if (!COUNT.test(args[at] ?? '')) {
                return false;
            }
        }
        else if (flag === undefined && shape.bareCount && BARE_COUNT.test(word)) {
            continue;
        }
        else if (flag === undefined) {
            if (word.startsWith('-') || word === '') {
                return false;
            }
            operands += 1;
        }
    }
    return operands === shape.operands;
}
