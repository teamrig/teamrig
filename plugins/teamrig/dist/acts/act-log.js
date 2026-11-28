import { toJsonlLine } from "../core/jsonl.js";
export const ACT_LOG_VERSION = 1;
/**
 * How long the act log keeps a record in place before it moves to the state archive, where it is never deleted: a
 * month covers a review of who did what since the last one, and a write rewrites the file about once a day at most.
 */
export const ACT_LOG_AGE = { keepDays: 30, slackDays: 1 };
/** The longest refusal or failure text a record keeps; the command printed the whole of it. */
export const ACT_REASON_MAX = 500;
function byRecord(by) {
    return by.kind === 'agent' ? { kind: by.kind, mark: by.mark } : { kind: by.kind };
}
function cut(text) {
    return text.length <= ACT_REASON_MAX ? text : `${text.slice(0, ACT_REASON_MAX - 1)}…`;
}
/** A flag whose value is encoded text (`--encoded-prompt <base64url>`): the scanner cannot read it, anyone can decode it. */
const ENCODED_FLAG = /^--encoded-[a-z0-9-]+$/;
const ENCODED_FLAG_WITH_VALUE = /^(--encoded-[a-z0-9-]+)=(.*)$/s;
/** What the log keeps of an encoded value: its length only. */
export function encodedMark(value) {
    return `[encoded, ${value.length} chars]`;
}
/** The arguments with each `--encoded-*` flag's value, given apart or after `=`, replaced by its mark. */
function withoutEncoded(argv) {
    return argv.map((word, index) => {
        const joined = ENCODED_FLAG_WITH_VALUE.exec(word);
        if (joined?.[1] !== undefined && joined[2] !== undefined)
            return `${joined[1]}=${encodedMark(joined[2])}`;
        const flag = argv[index - 1];
        return flag !== undefined && ENCODED_FLAG.test(flag) ? encodedMark(word) : word;
    });
}
/**
 * Each argument redacted, and then the arguments joined by spaces redacted again. Some secret shapes span a space
 * (an `Authorization: Bearer <token>` header, `password: <value>`, a key block), so a secret a shell split over two
 * words matches no single one. When the joined line redacts more, it is kept whole instead of the words.
 */
function keptArgv(argv, scanner) {
    const words = withoutEncoded(argv).map((word) => scanner.redact(word));
    const line = words.join(' ');
    const redacted = scanner.redact(line);
    return redacted === line ? { argv: words, joined: false } : { argv: [redacted], joined: true };
}
/**
 * The act's log line. Every argument and the reason pass the secret scanner's redaction first: a session may type a
 * key into a note by mistake, and the log must not keep what the register refused to. An encoded value is kept by
 * its length alone, as no scanner reads it.
 */
export function actLine(act, scanner) {
    const kept = keptArgv(act.argv, scanner);
    const record = {
        v: ACT_LOG_VERSION,
        at: act.at.toISOString(),
        ms: act.ms,
        session: act.session ?? null,
        by: byRecord(act.by),
        host: act.host ?? null,
        command: act.command,
        argv: [...kept.argv],
        joined: kept.joined,
        outcome: act.outcome,
        exit: act.exit,
        reason: act.reason === undefined ? null : cut(scanner.redact(act.reason)),
    };
    return toJsonlLine(record);
}
/** The team's act log: one line per write command run, appended in the order runs end. */
export class ActLog {
    log;
    scanner;
    constructor(log, scanner) {
        this.log = log;
        this.scanner = scanner;
    }
    append(act) {
        return this.log.append(actLine(act, this.scanner));
    }
}
