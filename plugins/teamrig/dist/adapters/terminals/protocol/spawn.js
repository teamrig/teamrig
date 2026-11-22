import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { ProgramOutputCapError } from "../../../plugin-api/index.js";
import { ANSWER_CAP_BYTES, failed, quoted } from "./wire.js";
/** How long one request may take: a terminal opens or lists in well under a second, so ten is a hung program. */
export const PROTOCOL_TIME_LIMIT_MS = 10_000;
/** The most a run may print, stdout and stderr together: an answer's cap and room for a page of its own errors. */
export const PROTOCOL_OUTPUT_CAP_BYTES = ANSWER_CAP_BYTES + 64 * 1024;
/**
 * The environment a terminal program gets: where programs and temporary files are, the home folder and the language.
 * No other name passes, so no teamrig credential (the GitHub key, a connector's token) ever reaches it.
 */
export const SHORT_ENV_NAMES = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG'];
const SHA256 = /^[0-9a-f]{64}$/;
export function sha256Of(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
/** Why a pin cannot run at all, or undefined: a path a shell or the working folder would resolve, or no sha256. */
export function pinProblem(pin) {
    if (!isAbsolute(pin.path)) {
        return `the terminal program's pinned path ${quoted(pin.path)} is not an absolute path`;
    }
    return SHA256.test(pin.sha256) ? undefined : `the terminal program's pin holds no sha256 (64 lowercase hex characters)`;
}
/**
 * The names of `env` that `SHORT_ENV_NAMES` lists, matched without case (Windows spells `Path` and `PATH` alike),
 * each under the spelling it had.
 */
export function shortEnv(env) {
    const allowed = new Set(SHORT_ENV_NAMES.map((name) => name.toUpperCase()));
    return Object.fromEntries(Object.entries(env).filter(([name, value]) => value !== undefined && allowed.has(name.toUpperCase())));
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function answerOf(path, result) {
    if (result.end.kind === 'signal') {
        return failed(`the terminal program ${path} was stopped by ${result.end.signal}, as when it outlives its time limit`);
    }
    if (result.end.code !== 0) {
        const [first = ''] = result.stderr.trim().split(/\r?\n/);
        return failed(`the terminal program ${path} exited with code ${result.end.code}${first === '' ? '' : `: ${quoted(first)}`}`);
    }
    return { kind: 'answered', output: result.stdout };
}
/**
 * The transport to a pinned terminal program, run once per request line. Each run reads the program's file, checks
 * its sha256 against the pin, and runs a private copy of exactly those bytes, so the file cannot change between the
 * check and the start; a file that no longer matches is never run. The program gets its pinned arguments, the request
 * line on stdin and the short environment. Every failure is an answer, never a throw.
 */
export function pinnedTransport(pin, ports) {
    const problem = pinProblem(pin);
    const env = shortEnv(ports.env);
    return async (line) => {
        if (problem !== undefined) {
            return failed(problem);
        }
        let program;
        try {
            const bytes = await ports.read(pin.path);
            if (bytes === undefined) {
                return failed(`the terminal program ${pin.path} is not there`);
            }
            const sha256 = sha256Of(bytes);
            if (sha256 !== pin.sha256) {
                return failed(`the terminal program ${pin.path} no longer matches its pin (its sha256 is now ${sha256}), so teamrig does not run it until the owner pins it again`);
            }
            program = await ports.stage(bytes, sha256, basename(pin.path));
        }
        catch (error) {
            return failed(`teamrig could not read or copy the terminal program ${pin.path}: ${quoted(messageOf(error))}`);
        }
        try {
            return answerOf(pin.path, await ports.run({ program, args: pin.args, env, input: line }));
        }
        catch (error) {
            if (error instanceof ProgramOutputCapError) {
                return failed(`the terminal program ${pin.path} printed more than ${PROTOCOL_OUTPUT_CAP_BYTES} bytes, so teamrig stopped it and used none of it`);
            }
            return failed(`the terminal program ${pin.path} would not start: ${quoted(messageOf(error))}`);
        }
    };
}
