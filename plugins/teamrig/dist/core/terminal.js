import { spawn } from 'node:child_process';
import { endOf } from "./shell-end.js";
/**
 * The real terminal: the program shares this process's stdio, so what the person types goes to it and never passes
 * teamrig. No time limit, as it waits on the person.
 */
export function nodeTerminal(stdin, stdout) {
    return {
        interactive: stdin.isTTY === true && stdout.isTTY === true,
        run: (request) => new Promise((resolve, reject) => {
            const env = request.env === undefined ? {} : { env: request.env };
            // Shown on purpose: the store's prompt must reach the person; it runs only from their own terminal.
            const child = spawn(request.program, [...request.args], { ...env, stdio: 'inherit' });
            child.once('error', reject);
            child.once('close', (code, signal) => resolve(endOf(code, signal)));
        }),
    };
}
