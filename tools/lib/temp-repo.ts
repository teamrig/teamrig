import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** The committer every temp repo is set up with. */
export const AUTHOR = { name: 'Dana Example', email: 'dana@example.com' } as const;

export interface CliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Variables a git hook or a CI runner sets, which must never steer git or a CLI under test. */
const INHERITED_GIT = /^GIT(?:HUB)?_/i;

/**
 * A throwaway folder for one test, where the repo tools run as their own process.
 * - Git there reads no global or system config, so a developer's own settings (a configured
 *   denylist, commit signing, hooks) never leak in, and never finds a repo above the folder.
 *   Its own config turns auto maintenance off, so no git runs on in the background.
 * - Inherited `GIT_*` variables are dropped (a test run from a git hook gets GIT_DIR and
 *   GIT_INDEX_FILE, which would point git at the real repo), and so are `GITHUB_*` ones, so a
 *   CI run's own event never reaches a CLI under test.
 */
export class TempRepo {
  /** The working folder, where git and the CLIs run. */
  readonly dir: string;
  /** A folder beside `dir`, for files that must stay out of the repo, such as a CI event payload. */
  readonly outside: string;
  private readonly root: string;
  /** The environment git and the CLIs run in here, for a git adapter under test to run its own git in. */
  readonly env: Readonly<Record<string, string>>;

  constructor(prefix: string) {
    // The native realpath also spells out Windows' short 8.3 names (GitHub's runner has TEMP under RUNNER~1), as git
    // does when it prints a path: the JS realpath leaves them, and a spec's expected path would then differ from git's.
    this.root = mkdtempSync(join(realpathSync.native(tmpdir()), `teamrig-${prefix}-`));
    this.dir = join(this.root, 'repo');
    this.outside = join(this.root, 'outside');
    mkdirSync(this.dir);
    mkdirSync(this.outside);
    const globalConfig = join(this.root, 'gitconfig');
    // git 2.47+ ends a commit by starting `git maintenance run --auto --detach`, which outlives it and creates and
    // deletes .git/objects/maintenance.lock: a copyFrom walking the folder then meets a file gone before it is copied
    // (macOS CI, cpSync ENOENT, T5182). No git here may change a repo after its command returns.
    writeFileSync(globalConfig, '[maintenance]\n\tauto = false\n');
    const inherited = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !INHERITED_GIT.test(entry[0]));
    this.env = {
      ...Object.fromEntries(inherited),
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CEILING_DIRECTORIES: this.root,
    };
  }

  /** Makes `dir` a repo that commits as AUTHOR. */
  init(): this {
    this.git('init', '-q');
    this.git('config', 'user.name', AUTHOR.name);
    this.git('config', 'user.email', AUTHOR.email);
    return this;
  }

  /**
   * Copies `template`'s working and outside folders here, so a spec builds its repos once and each test starts from
   * its own copy: copying files costs far less than the git runs that made them, which take seconds per test on a
   * loaded Windows host (T5032). A remote the template names by path still points at the template's folder; a test
   * that talks to it re-points it here (`git remote set-url`).
   */
  copyFrom(template: TempRepo): this {
    cpSync(template.dir, this.dir, { recursive: true });
    cpSync(template.outside, this.outside, { recursive: true });
    return this;
  }

  /** Writes a file at a `/`-separated path under `dir`, creating its folders; returns its absolute path. */
  write(path: string, content: string): string {
    const absolute = join(this.dir, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    return absolute;
  }

  has(path: string): boolean {
    return existsSync(join(this.dir, ...path.split('/')));
  }

  /** Runs git in `dir`, fails the test when it fails, and returns its stdout. */
  git(...args: readonly string[]): string {
    const result = spawnSync('git', args, { cwd: this.dir, env: this.env, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  }

  /**
   * Runs a tool's CLI in `dir` under this Node; `undefined` in `env` removes an inherited variable.
   * An override replaces the inherited name in any case: Windows reads names case-insensitively, and
   * Git Bash hands Node `COMSPEC` where cmd.exe hands it `ComSpec`. `input` is its stdin, which is empty when absent.
   */
  run(cli: string, args: readonly string[] = [], env: Readonly<Record<string, string | undefined>> = {}, input?: string): CliRun {
    return this.spawn(this.dir, cli, args, env, input);
  }

  /** Runs a tool's CLI as `run` does, but in `outside`, where git finds no repo. */
  runOutside(cli: string, args: readonly string[] = []): CliRun {
    return this.spawn(this.outside, cli, args, {});
  }

  private spawn(cwd: string, cli: string, args: readonly string[], env: Readonly<Record<string, string | undefined>>, input?: string): CliRun {
    const overridden = new Set(Object.keys(env).map((name) => name.toUpperCase()));
    const inherited = Object.entries(this.env).filter(([name]) => !overridden.has(name.toUpperCase()));
    const merged = [...inherited, ...Object.entries(env)].filter((entry): entry is [string, string] => entry[1] !== undefined);
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env: Object.fromEntries(merged), encoding: 'utf8', ...(input === undefined ? {} : { input }) });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  remove(): void {
    removeHeldFolder(this.root);
  }
}

/**
 * The codes Windows gives while a live process holds a folder or a file in it: a folder that is a process's cwd
 * refuses removal with EBUSY or EPERM, and a removal racing a file still being closed leaves ENOTEMPTY.
 */
const HELD_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

/**
 * About 10 s in all, the short waits first. A spec that stops git at its time limit kills only git on Windows, so the
 * child git started (an alias's node) can still be ending in the repo; under host load it outlived 1 s (T5814).
 */
export const REMOVE_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, ...Array.from({ length: 18 }, () => 500)];

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/**
 * Removes `path` and everything in it, repeating after each delay while a live process holds it; any other error, or a
 * held one after the last delay, is thrown as it came. rmSync's own maxRetries cannot stand in: on Node 22 it retries
 * only the top folder, so an EBUSY on a nested folder (the repo a child's cwd holds) is thrown at once (T5814).
 */
export function removeHeldFolder(
  path: string,
  remove: (path: string) => void = removeTree,
  sleep: (ms: number) => void = sleepSync,
  delays: readonly number[] = REMOVE_RETRY_DELAYS_MS,
): void {
  for (const delay of delays) {
    try {
      remove(path);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (code === undefined || !HELD_CODES.has(code)) {
        throw error;
      }
    }
    sleep(delay);
  }
  remove(path);
}
