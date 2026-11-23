import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
/** PowerShell reading its commands from standard input, each line run as it arrives. */
export function powerShellSpec(timeoutMs, maxBytes) {
    return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', '-'],
        echo: (marker) => `'${marker}'`,
        timeoutMs,
        maxBytes,
    };
}
/**
 * A shell started at its first script and kept for the next ones, one at a time. After each script it sends the echo
 * of a marker no output can hold by chance (a fresh id and a count), and what came before that marker is the
 * script's output. A script that errs still reaches its marker. A script past its time limit or its byte cap, or a
 * shell that exits or never starts, settles with undefined, and the shell is ended: the next script starts a fresh
 * one, so one hang costs one script, not the run. A script holding a line break settles with undefined unsent: the
 * shell would run it as several.
 */
export function lineShellOf(spec) {
    const id = randomUUID();
    let count = 0;
    let child;
    let output = '';
    let waiting;
    let timer;
    let tail = Promise.resolve();
    const finish = (printed) => {
        const done = waiting;
        waiting = undefined;
        clearTimeout(timer);
        timer = undefined;
        done?.settle(printed);
    };
    const end = () => {
        const ended = child;
        child = undefined;
        output = '';
        if (ended !== undefined) {
            ended.stdin.destroy();
            ended.stdout.destroy();
            ended.kill();
        }
    };
    const fail = () => {
        end();
        finish(undefined);
    };
    const read = (chunk) => {
        output += chunk;
        const marker = waiting?.marker;
        const at = marker === undefined ? -1 : output.indexOf(marker);
        // The cap holds whether or not the marker came in the same chunk: a pipe may join a flood and its marker.
        if ((at >= 0 ? at : output.length) > spec.maxBytes) {
            fail();
        }
        else if (marker !== undefined && at >= 0) {
            const printed = output.slice(0, at);
            output = output.slice(at + marker.length).replace(/^\r?\n/, '');
            finish(printed);
        }
    };
    const started = () => {
        if (child !== undefined) {
            return child;
        }
        const fresh = spawn(spec.file, [...spec.args], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        fresh.stdout.setEncoding('utf8');
        fresh.stdout.on('data', (chunk) => {
            if (child === fresh) {
                read(chunk);
            }
        });
        const lost = () => {
            if (child === fresh) {
                fail();
            }
        };
        fresh.on('error', lost);
        fresh.on('exit', lost);
        // A write to a shell that just exited fails here; its exit settles the script.
        fresh.stdin.on('error', () => undefined);
        child = fresh;
        return fresh;
    };
    const runNow = (script) => {
        if (/[\r\n]/.test(script)) {
            return Promise.resolve(undefined);
        }
        count += 1;
        const marker = `teamrig-shell-done-${id}-${count}`;
        return new Promise((settle) => {
            waiting = { marker, settle };
            timer = setTimeout(fail, spec.timeoutMs);
            started().stdin.write(`${script}\n${spec.echo(marker)}\n`);
        });
    };
    return {
        run: (script) => {
            const result = tail.then(() => runNow(script));
            tail = result;
            return result;
        },
        close: () => {
            end();
            finish(undefined);
        },
    };
}
