import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The coverage files Node's test runner reads from its coverage folder, as its own runner matches them
 * (`kCoverageFileRegex` in Node's lib/internal/test_runner/coverage.js); it reads no subfolder.
 */
export const COVERAGE_FILE = /^coverage-\d+-\d{13}-\d+\.json$/;

/** The folder the children of the test-file process `pid` write their coverage to, inside the run's coverage folder. */
export function childFolder(runFolder: string, pid: number): string {
  return join(runFolder, `children-${pid}`);
}

/** Whether a coverage file's text is whole: one a process was killed while writing ends partway through its JSON. */
export function isWhole(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // A child still running can hold its file open; it is not done, so its coverage is not whole either.
    return undefined;
  }
}

/**
 * Moves each whole coverage file in `from` into `to` and returns the names of those it dropped as cut short, then
 * removes `from`. A folder a child that outlived its test still holds open stays: the gate removes the run's folder.
 */
export function sweepChildCoverage(from: string, to: string): string[] {
  let names: string[];
  try {
    names = readdirSync(from);
  } catch {
    return [];
  }
  const dropped: string[] = [];
  for (const name of names.filter((entry) => COVERAGE_FILE.test(entry))) {
    const path = join(from, name);
    const text = readOrUndefined(path);
    if (text !== undefined && isWhole(text)) {
      renameSync(path, join(to, name));
    } else {
      dropped.push(name);
    }
  }
  try {
    rmSync(from, { recursive: true, force: true });
  } catch {
    // Kept for the gate's own removal of the run folder, as above.
  }
  return dropped;
}

/** What routing a test-file process's child coverage needs from its process. */
export interface RouteDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly pid: number;
  /** The test file the process runs, named in a drop's line so its spawner can be found. */
  readonly file: string;
  readonly onExit: (listener: () => void) => void;
  readonly warn: (line: string) => void;
}

/** The parts of a Node process routing reads and hooks: `process` itself, or a fake in a spec. */
export interface ProcessView {
  readonly env: NodeJS.ProcessEnv;
  readonly pid: number;
  readonly argv: readonly string[];
  on(event: 'exit', listener: () => void): unknown;
  readonly stderr: { write(text: string): unknown };
}

/** The routing deps of a process: its env and pid, the test file it runs, its exit event and its stderr. */
export function processDeps(proc: ProcessView): RouteDeps {
  return {
    env: proc.env,
    pid: proc.pid,
    file: proc.argv[1] ?? '(no file)',
    onExit: (listener) => {
      proc.on('exit', listener);
    },
    warn: (line) => {
      proc.stderr.write(`${line}\n`);
    },
  };
}

/**
 * Node's test runner reads every coverage file of the run as it ends and, when one does not parse, reports no
 * coverage at all ("Could not report code coverage"), failing the run (T5551). A test's child killed while it writes
 * its file at its exit leaves one cut short, and many tests kill children. So in a test-file process (one the runner
 * started: NODE_TEST_CONTEXT set) the children write to a folder of their own, which the process moves into the
 * run's folder as it exits, whole files only. The process's own file still goes to the run's folder, as V8 took that
 * folder as the process started. The runner process itself, and a process outside a coverage run, are left alone.
 */
export function routeChildCoverage(deps: RouteDeps): void {
  const runFolder = deps.env['NODE_V8_COVERAGE'];
  if (runFolder === undefined || runFolder === '' || deps.env['NODE_TEST_CONTEXT'] === undefined) return;
  const folder = childFolder(runFolder, deps.pid);
  mkdirSync(folder, { recursive: true });
  deps.env['NODE_V8_COVERAGE'] = folder;
  deps.onExit(() => {
    for (const name of sweepChildCoverage(folder, runFolder)) {
      deps.warn(`coverage: dropped ${name}, a coverage file a child of ${deps.file} left cut short (such as one killed while it exited)`);
    }
  });
}
