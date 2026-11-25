/**
 * teamrig's host-neutral install, for an AI CLI that loads no teamrig plugin: a person downloads this one file from the
 * release branch and runs `node install-teamrig.ts [--host <name>]... [--yes]`. It keeps a shallow clone of the public
 * release branch at `<teamrig home>/install/teamrig` (TEAMRIG_HOME, else ~/.teamrig); a later run clones afresh and
 * swaps the new clone in, keeping the old one aside, and a folder there that is no git clone is refused. Then, for
 * each `--host`, it runs that install's own
 * `teamrig setup hooks --host <name>`, which previews and, with --yes, writes the host's hooks file. It edits no shell
 * profile: it prints the folder to put on PATH.
 *
 * The file imports only Node's own modules, since it runs before any teamrig is on the machine; for the same reason it
 * names no host: each host's words come from its adapter, through `setup hooks`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The public repository and the branch the release workflow publishes, with its built dist. */
export const RELEASE_REPO = 'https://github.com/teamrig/teamrig.git';
export const RELEASE_BRANCH = 'release';

/** What one program run gave: its exit code (-1 when it could not start) and its output. */
export interface InstallRun {
  readonly code: number;
  readonly out: string;
}

export type InstallRunner = (command: string, args: readonly string[]) => InstallRun;

export interface InstallInput {
  readonly kitHome: string;
  readonly platform: NodeJS.Platform;
  /** The node program running this script, which also runs the installed teamrig. */
  readonly nodePath: string;
  /** The hosts to connect, as `setup hooks --host` takes them. */
  readonly hosts: readonly string[];
  readonly write: boolean;
  /** Whether a path exists. */
  readonly exists: (path: string) => boolean;
  /** Moves a folder; throws when it cannot. */
  readonly rename: (from: string, to: string) => void;
  /** The folder the script runs in, where Windows looks for a bare program before PATH. */
  readonly cwd: string;
  /** A name-safe time stamp for this run's new and old folders. */
  readonly stamp: string;
}

/** The names Windows would start for a bare `git` found in the current folder. */
const WINDOWS_PROGRAM_SUFFIXES = ['.exe', '.com', '.bat', '.cmd'];

export interface InstallReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export type InstallArgs = { readonly kind: 'args'; readonly hosts: readonly string[]; readonly write: boolean } | { readonly kind: 'usage'; readonly problem: string };

export const USAGE = 'usage: node install-teamrig.ts [--host <name>]... [--yes]';

/** The script's arguments: each `--host <name>`, and `--yes`; anything else is a usage problem. */
export function parseInstallArgs(argv: readonly string[]): InstallArgs {
  const hosts: string[] = [];
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index];
    if (word === '--yes') {
      write = true;
    } else if (word === '--host') {
      const name = argv[index + 1];
      if (name === undefined || name.startsWith('--')) {
        return { kind: 'usage', problem: '--host needs a host name' };
      }
      hosts.push(name);
      index += 1;
    } else {
      return { kind: 'usage', problem: `unknown argument ${word ?? ''}` };
    }
  }
  return { kind: 'args', hosts, write };
}

class InstallStop extends Error {}

/**
 * Installs or updates the clone, runs its teamrig, and connects each host. Stops at the first step that fails, with
 * what failed and what to do; a refusal leaves the folder it found as it was.
 *
 * It never runs git inside an install already there: anything under the teamrig home may have been changed since
 * (a hook or config in its .git runs in the person's own terminal, and a checkout keeps local edits), so every run
 * clones fresh into a sibling folder, checks it runs, and only then moves the old install aside, never deleting it.
 */
export function installTeamrig(input: InstallInput, run: InstallRunner): InstallReport {
  const path = input.platform === 'win32' ? win32 : posix;
  const lines: string[] = [];
  const must = (label: string, command: string, args: readonly string[]): string => {
    const { code, out } = run(command, args);
    if (code !== 0) {
      lines.push(`FAILED ${label} (exit ${code})${out === '' ? '' : `:\n${out}`}`);
      throw new InstallStop();
    }
    return out;
  };
  const refuse = (line: string): never => {
    lines.push(line);
    throw new InstallStop();
  };
  const clone = path.join(input.kitHome, 'install', 'teamrig');
  const fresh = `${clone}.new-${input.stamp}`;
  const aside = `${clone}.old-${input.stamp}`;
  const cliIn = (folder: string): string => path.join(folder, 'plugins', 'teamrig', 'dist', 'cli', 'main.js');
  try {
    if (input.platform === 'win32') {
      // Windows starts a bare program from the current folder before PATH, so a downloaded git.exe would run.
      const planted = WINDOWS_PROGRAM_SUFFIXES.map((suffix) => path.join(input.cwd, `git${suffix}`)).find(input.exists);
      if (planted !== undefined) {
        refuse(`REFUSED ${planted} would run as git; run this from your home folder (cd ~) instead`);
      }
    }
    must('git is needed: install it from https://git-scm.com', 'git', ['--version']);
    const present = input.exists(clone);
    if (present && !input.exists(path.join(clone, '.git'))) {
      refuse(`REFUSED ${clone} exists and is not a teamrig install; move it away and run this again`);
    }
    must('clone the release branch', 'git', ['clone', '-q', '--depth', '1', '--branch', RELEASE_BRANCH, RELEASE_REPO, fresh]);
    const version = must(`run the new teamrig (it stays in ${fresh}; the install in use is unchanged)`, input.nodePath, [cliIn(fresh), '--version']);
    if (present) {
      moveOrStop(input, clone, aside, lines);
    }
    try {
      input.rename(fresh, clone);
    } catch (error) {
      if (present) {
        moveOrStop(input, aside, clone, lines);
      }
      refuse(`FAILED move ${fresh} to ${clone}: ${String(error)}; the install in use is unchanged`);
    }
    lines.push(`${present ? 'UPDATED' : 'CLONED'} ${RELEASE_REPO} (${RELEASE_BRANCH}) into ${clone}`, version);
    if (present) {
      lines.push(`KEPT the old install at ${aside}: delete it once this one works`);
    }
    const plugin = path.join(clone, 'plugins', 'teamrig');
    const cli = cliIn(clone);
    for (const host of input.hosts) {
      lines.push(must(`setup hooks --host ${host}`, input.nodePath, [cli, 'setup', 'hooks', '--host', host, ...(input.write ? ['--yes'] : [])]));
    }
    const bin = path.join(plugin, 'bin');
    lines.push('', `teamrig is installed at ${plugin}.`, `Put ${bin} on your PATH, then open a new terminal:`);
    lines.push(
      input.platform === 'win32'
        ? `  Settings > System > About > Advanced system settings > Environment Variables > Path > New: ${bin}`
        : `  add  export PATH="${bin}:$PATH"  to your shell's profile (~/.zshrc or ~/.bashrc)`,
    );
    lines.push(nextStep(input));
    return { ok: true, lines };
  } catch (error) {
    if (error instanceof InstallStop) {
      return { ok: false, lines };
    }
    throw error;
  }
}

/** Moves a folder, or stops the install naming the move that failed. */
function moveOrStop(input: InstallInput, from: string, to: string, lines: string[]): void {
  try {
    input.rename(from, to);
  } catch (error) {
    lines.push(`FAILED move ${from} to ${to}: ${String(error)}`);
    throw new InstallStop();
  }
}

/** A time stamp safe in a folder name on every OS, such as 20261125T183005Z. */
export function folderStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function nextStep(input: InstallInput): string {
  if (input.hosts.length === 0) {
    return 'Connect your AI CLI: run this again with --host <name> (teamrig setup hooks names the hosts it knows).';
  }
  return input.write
    ? 'Then open each host and trust teamrig\'s hooks where it asks. Run this script again after each teamrig release.'
    : 'Nothing was written to the hosts yet: run it again with --yes to write their hooks.';
}

/** Runs a program to its end with no shell and no window, giving its exit code and both output streams. */
export function runProgram(command: string, args: readonly string[]): InstallRun {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error === undefined ? '' : String(result.error)}`.trim();
  return { code: result.status ?? -1, out };
}

/** TEAMRIG_HOME when it names a folder, else ~/.teamrig, as teamrig itself resolves its home. */
export function kitHomeOf(named: string | undefined, platform: NodeJS.Platform, home: string = homedir()): string {
  return named !== undefined && named.trim() !== '' ? named : (platform === 'win32' ? win32 : posix).join(home, '.teamrig');
}

function isEntry(): boolean {
  const started = process.argv[1];
  return started !== undefined && existsSync(started) && realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
}

/** What one run of the script reads from its machine and where it prints. */
export interface InstallEnvironment {
  readonly teamrigHome: string | undefined;
  readonly platform: NodeJS.Platform;
  readonly nodePath: string;
  readonly home: string;
  readonly exists: (path: string) => boolean;
  readonly rename: (from: string, to: string) => void;
  readonly cwd: string;
  readonly now: Date;
  readonly run: InstallRunner;
  readonly print: (line: string) => void;
  readonly printError: (line: string) => void;
}

/** The script's whole run from its arguments: 0 installed, 1 a step failed or was refused, 2 a usage problem. */
export function runInstall(argv: readonly string[], env: InstallEnvironment): number {
  const parsed = parseInstallArgs(argv);
  if (parsed.kind === 'usage') {
    env.printError(`${parsed.problem}\n${USAGE}`);
    return 2;
  }
  const report = installTeamrig(
    {
      kitHome: kitHomeOf(env.teamrigHome, env.platform, env.home),
      platform: env.platform,
      nodePath: env.nodePath,
      hosts: parsed.hosts,
      write: parsed.write,
      exists: env.exists,
      rename: env.rename,
      cwd: env.cwd,
      stamp: folderStamp(env.now),
    },
    env.run,
  );
  report.lines.forEach((line) => (report.ok ? env.print(line) : env.printError(line)));
  return report.ok ? 0 : 1;
}

if (isEntry()) {
  process.exit(
    runInstall(process.argv.slice(2), {
      teamrigHome: process.env['TEAMRIG_HOME'],
      platform: process.platform,
      nodePath: process.execPath,
      home: homedir(),
      exists: existsSync,
      rename: renameSync,
      cwd: process.cwd(),
      now: new Date(),
      run: runProgram,
      print: (line) => console.log(line),
      printError: (line) => console.error(line),
    }),
  );
}
