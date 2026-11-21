import { spawn } from 'node:child_process';
import { endOf } from "./shell-end.js";
/** A run stopped for printing more than its cap; nothing it printed is used. */
export class ProgramOutputCapError extends Error {
    name = 'ProgramOutputCapError';
    constructor(program, maxBytes) {
        super(`${program} printed more than ${maxBytes} bytes, so teamrig stopped it and used none of it`);
    }
}
/**
 * The real runner: `spawn` with no shell, stdin closed, and the caller's time limit. With `maxBytes`, a run that
 * prints more than that, stdout and stderr together, is stopped and rejects with ProgramOutputCapError: the cap of a
 * tool whose output holds text people post, so no run's memory grows without bound. Without it nothing is capped.
 */
export function nodeProgramRunner(timeoutMs, maxBytes = Number.POSITIVE_INFINITY) {
    return (request) => new Promise((resolve, reject) => {
        const env = request.env === undefined ? {} : { env: request.env };
        const child = spawn(request.program, [...request.args], { ...env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, windowsHide: true });
        const stdout = [];
        const stderr = [];
        let printed = 0;
        let over = false;
        const keep = (into) => (chunk) => {
            if (over) {
                return;
            }
            printed += chunk.length;
            if (printed > maxBytes) {
                over = true;
                stdout.length = 0;
                stderr.length = 0;
                child.kill();
                return;
            }
            into.push(chunk);
        };
        child.stdout.on('data', keep(stdout));
        child.stderr.on('data', keep(stderr));
        child.once('error', reject);
        child.once('close', (code, signal) => {
            if (over) {
                reject(new ProgramOutputCapError(request.program, maxBytes));
                return;
            }
            // Joined before decoding, so a character split across two chunks reads whole.
            resolve({ end: endOf(code, signal), stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
        });
    });
}
