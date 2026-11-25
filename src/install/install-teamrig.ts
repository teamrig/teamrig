/**
 * teamrig's host-neutral install, for an AI CLI that loads no teamrig plugin: a person downloads this one file from the
 * release branch and runs `node install-teamrig.ts [--host <name>]... [--yes]`. It keeps a shallow clone of the public
 * release branch at `<teamrig home>/install/teamrig` (TEAMRIG_HOME, else ~/.teamrig), updates it on a later run, and
 * refuses a folder there that is not that clone. Then, for each `--host`, it runs that install's own
 * `teamrig setup hooks --host <name>`, which previews and, with --yes, writes the host's hooks file. It edits no shell
 * profile: it prints the folder to put on PATH.
 *
 * The file imports only Node's own modules, since it runs before any teamrig is on the machine; for the same reason it
 * names no host: each host's words come from its adapter, through `setup hooks`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
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
}

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

/** The same repository whether or not its URL ends in `.git`, as git prints whichever was cloned. */
function isReleaseRepo(url: string): boolean {
  return url === RELEASE_REPO || `${url}.git` === RELEASE_REPO;
}

class InstallStop extends Error {}

/**
 * Installs or updates the clone, runs its teamrig, and connects each host. Stops at the first step that fails, with
 * what failed and what to do; a refusal leaves the folder it found as it was.
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
  try {
    must('git is needed: install it from https://git-scm.com', 'git', ['--version']);
    if (input.exists(path.join(clone, '.git'))) {
      // Only the clone this script made is updated: a folder of another repository is left alone.
      const origin = must('read the install folder origin', 'git', ['-C', clone, 'remote', 'get-url', 'origin']);
      if (!isReleaseRepo(origin)) {
        refuse(`REFUSED ${clone} is a git folder of ${origin}, not ${RELEASE_REPO}; move it away and run this again`);
      }
      must('fetch the release branch', 'git', ['-C', clone, 'fetch', '-q', '--depth', '1', 'origin', RELEASE_BRANCH]);
      must('move to the newest release', 'git', ['-C', clone, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
      lines.push(`UPDATED ${clone} to the newest release`);
    } else if (input.exists(clone)) {
      refuse(`REFUSED ${clone} exists and is not a teamrig install; move it away and run this again`);
    } else {
      must('clone the release branch', 'git', ['clone', '-q', '--depth', '1', '--branch', RELEASE_BRANCH, RELEASE_REPO, clone]);
      lines.push(`CLONED ${RELEASE_REPO} (${RELEASE_BRANCH}) into ${clone}`);
    }
    const plugin = path.join(clone, 'plugins', 'teamrig');
    const cli = path.join(plugin, 'dist', 'cli', 'main.js');
    lines.push(must('run the installed teamrig', input.nodePath, [cli, '--version']));
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

function nextStep(input: InstallInput): string {
  if (input.hosts.length === 0) {
    return 'Connect your AI CLI: run this again with --host <name> (teamrig setup hooks names the hosts it knows).';
  }
  return input.write
    ? 'Then open each host and trust teamrig\'s hooks where it asks. Run this script again after each teamrig release.'
    : 'Nothing was written to the hosts yet: run it again with --yes to write their hooks.';
}

function runProgram(command: string, args: readonly string[]): InstallRun {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
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

if (isEntry()) {
  const parsed = parseInstallArgs(process.argv.slice(2));
  if (parsed.kind === 'usage') {
    console.error(`${parsed.problem}\n${USAGE}`);
    process.exit(2);
  }
  const report = installTeamrig(
    {
      kitHome: kitHomeOf(process.env['TEAMRIG_HOME'], process.platform),
      platform: process.platform,
      nodePath: process.execPath,
      hosts: parsed.hosts,
      write: parsed.write,
      exists: existsSync,
    },
    runProgram,
  );
  report.lines.forEach((line) => (report.ok ? console.log(line) : console.error(line)));
  process.exit(report.ok ? 0 : 1);
}
