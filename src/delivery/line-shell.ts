import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

/** Runs one script; settles with what it printed, or undefined when it failed, timed out or never started. */
export type ScriptRun = (script: string) => Promise<string | undefined>;

/** A shell kept open across scripts, so a run of several pays its launch once; `close` ends it. */
export interface ScriptShell {
  readonly run: ScriptRun;
  close(): void;
}

/** How to start a shell that reads one script a line from its standard input. */
export interface LineShellSpec {
  readonly file: string;
  readonly args: readonly string[];
  /** The line that makes the shell print `marker` alone, once the script before it has ended. */
  echo(marker: string): string;
  /** Bounds each script, so a hung one cannot hold its caller forever. */
  readonly timeoutMs: number;
  /** Bytes one script may print. */
  readonly maxBytes: number;
}

/** PowerShell reading its commands from standard input, each line run as it arrives. */
export function powerShellSpec(timeoutMs: number, maxBytes: number): LineShellSpec {
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', '-'],
    echo: (marker) => `'${marker}'`,
    timeoutMs,
    maxBytes,
  };
}

type ShellChild = ChildProcessByStdio<Writable, Readable, null>;

/** The script waiting on the shell: it settles when its marker prints, or with undefined when the shell fails. */
interface Waiting {
  readonly marker: string;
  readonly settle: (printed: string | undefined) => void;
}

/**
 * A shell started at its first script and kept for the next ones, one at a time. After each script it sends the echo
 * of a marker no output can hold by chance (a fresh id and a count), and what came before that marker is the
 * script's output. A script that errs still reaches its marker. A script past its time limit or its byte cap, or a
 * shell that exits or never starts, settles with undefined, and the shell is ended: the next script starts a fresh
 * one, so one hang costs one script, not the run. A script holding a line break settles with undefined unsent: the
 * shell would run it as several.
 */
export function lineShellOf(spec: LineShellSpec): ScriptShell {
  const id = randomUUID();
  let count = 0;
  let child: ShellChild | undefined;
  let output = '';
  let waiting: Waiting | undefined;
  let timer: NodeJS.Timeout | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  const finish = (printed: string | undefined): void => {
    const done = waiting;
    waiting = undefined;
    clearTimeout(timer);
    timer = undefined;
    done?.settle(printed);
  };
  const end = (): void => {
    const ended = child;
    child = undefined;
    output = '';
    if (ended !== undefined) {
      ended.stdin.destroy();
      ended.stdout.destroy();
      ended.kill();
    }
  };
  const fail = (): void => {
    end();
    finish(undefined);
  };
  const read = (chunk: string): void => {
    output += chunk;
    const marker = waiting?.marker;
    const at = marker === undefined ? -1 : output.indexOf(marker);
    // The cap holds whether or not the marker came in the same chunk: a pipe may join a flood and its marker.
    if ((at >= 0 ? at : output.length) > spec.maxBytes) {
      fail();
    } else if (marker !== undefined && at >= 0) {
      const printed = output.slice(0, at);
      output = output.slice(at + marker.length).replace(/^\r?\n/, '');
      finish(printed);
    }
  };
  const started = (): ShellChild => {
    if (child !== undefined) {
      return child;
    }
    const fresh = spawn(spec.file, [...spec.args], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    fresh.stdout.setEncoding('utf8');
    fresh.stdout.on('data', (chunk: string) => {
      if (child === fresh) {
        read(chunk);
      }
    });
    const lost = (): void => {
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
  const runNow = (script: string): Promise<string | undefined> => {
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
