/**
 * teamrig's host-neutral install, for an AI CLI that loads no teamrig plugin: a person downloads this one file from the
 * release branch and runs `node install-teamrig.ts [--host <name>]... [--yes]`. It keeps a shallow clone of the public
 * release branch at `<teamrig home>/install/teamrig` (TEAMRIG_HOME, else ~/.teamrig); a later run clones afresh and
 * swaps the new clone in, keeping the old one aside, and a folder there that is no git clone is refused. Then it runs
 * that install's own `teamrig kit install`, which copies it into the kit home as the release its tag and commit name
 * (the kit home a host's hook lines run from), and for each `--host` its `teamrig setup hooks --host <name>`; each
 * previews and, with --yes, writes. It edits no shell
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
/** The names Windows would start for a bare `git` found in the current folder. */
const WINDOWS_PROGRAM_SUFFIXES = ['.exe', '.com', '.bat', '.cmd'];
export const USAGE = 'usage: node install-teamrig.ts [--host <name>]... [--yes]';
/** The script's arguments: each `--host <name>`, and `--yes`; anything else is a usage problem. */
export function parseInstallArgs(argv) {
    const hosts = [];
    let write = false;
    for (let index = 0; index < argv.length; index += 1) {
        const word = argv[index];
        if (word === '--yes') {
            write = true;
        }
        else if (word === '--host') {
            const name = argv[index + 1];
            if (name === undefined || name.startsWith('--')) {
                return { kind: 'usage', problem: '--host needs a host name' };
            }
            hosts.push(name);
            index += 1;
        }
        else {
            return { kind: 'usage', problem: `unknown argument ${word ?? ''}` };
        }
    }
    return { kind: 'args', hosts, write };
}
class InstallStop extends Error {
}
/**
 * Installs or updates the clone, runs its teamrig, and connects each host. Stops at the first step that fails, with
 * what failed and what to do; a refusal leaves the folder it found as it was.
 *
 * It never runs git inside an install already there: anything under the teamrig home may have been changed since
 * (a hook or config in its .git runs in the person's own terminal, and a checkout keeps local edits), so every run
 * clones fresh into a sibling folder, checks it runs, and only then moves the old install aside, never deleting it.
 */
export function installTeamrig(input, run) {
    const path = input.platform === 'win32' ? win32 : posix;
    const lines = [];
    const must = (label, command, args) => {
        const { code, out } = run(command, args);
        if (code !== 0) {
            lines.push(`FAILED ${label} (exit ${code})${out === '' ? '' : `:\n${out}`}`);
            throw new InstallStop();
        }
        return out;
    };
    const refuse = (line) => {
        lines.push(line);
        throw new InstallStop();
    };
    const clone = path.join(input.kitHome, 'install', 'teamrig');
    const fresh = `${clone}.new-${input.stamp}`;
    const aside = `${clone}.old-${input.stamp}`;
    const cliIn = (folder) => path.join(folder, 'plugins', 'teamrig', 'dist', 'cli', 'main.js');
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
        const tag = releaseTagOf(version) ?? refuse(`FAILED the new teamrig printed no version (${version}); it stays in ${fresh}; the install in use is unchanged`);
        // The new clone is this run's own, so git runs in it; never in an install already there.
        const commit = must(`read the new clone's commit (it stays in ${fresh}; the install in use is unchanged)`, 'git', ['-C', fresh, 'rev-parse', 'HEAD']);
        if (present) {
            moveOrStop(input, clone, aside, lines);
        }
        try {
            input.rename(fresh, clone);
        }
        catch (error) {
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
        // Before any host's hooks: a host whose lines run the kit launcher needs the kit home to hold this teamrig first.
        lines.push(must('kit install', input.nodePath, [cli, 'kit', 'install', '--tag', tag, '--commit', commit, ...(input.write ? ['--yes'] : [])]));
        for (const host of input.hosts) {
            lines.push(must(`setup hooks --host ${host}`, input.nodePath, [cli, 'setup', 'hooks', '--host', host, ...(input.write ? ['--yes'] : [])]));
        }
        const bin = path.join(plugin, 'bin');
        lines.push('', `teamrig is installed at ${plugin}.`, `Put ${bin} on your PATH, then open a new terminal:`);
        lines.push(input.platform === 'win32'
            ? `  Settings > System > About > Advanced system settings > Environment Variables > Path > New: ${bin}`
            : `  add  export PATH="${bin}:$PATH"  to your shell's profile (~/.zshrc or ~/.bashrc)`);
        lines.push(nextStep(input));
        return { ok: true, lines };
    }
    catch (error) {
        if (error instanceof InstallStop) {
            return { ok: false, lines };
        }
        throw error;
    }
}
/** The release tag of what `teamrig --version` printed (`teamrig 1.2.3` gives `v1.2.3`); undefined for any other output. */
export function releaseTagOf(printed) {
    const version = /^teamrig (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(printed.trim())?.[1];
    return version === undefined ? undefined : `v${version}`;
}
/** Moves a folder, or stops the install naming the move that failed. */
function moveOrStop(input, from, to, lines) {
    try {
        input.rename(from, to);
    }
    catch (error) {
        lines.push(`FAILED move ${from} to ${to}: ${String(error)}`);
        throw new InstallStop();
    }
}
/** A time stamp safe in a folder name on every OS, such as 20261125T183005Z. */
export function folderStamp(now) {
    return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}
function nextStep(input) {
    if (input.hosts.length === 0) {
        return 'Connect your AI CLI: run this again with --host <name> (teamrig setup hooks names the hosts it knows).';
    }
    return input.write
        ? 'Then open each host and trust teamrig\'s hooks where it asks. Run this script again after each teamrig release.'
        : 'Nothing was written to the kit home or the hosts yet: run it again with --yes to write them.';
}
/** Runs a program to its end with no shell and no window, giving its exit code and both output streams. */
export function runProgram(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error === undefined ? '' : String(result.error)}`.trim();
    return { code: result.status ?? -1, out };
}
/** TEAMRIG_HOME when it names a folder, else ~/.teamrig, as teamrig itself resolves its home. */
export function kitHomeOf(named, platform, home = homedir()) {
    return named !== undefined && named.trim() !== '' ? named : (platform === 'win32' ? win32 : posix).join(home, '.teamrig');
}
function isEntry() {
    const started = process.argv[1];
    return started !== undefined && existsSync(started) && realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
}
/** The script's whole run from its arguments: 0 installed, 1 a step failed or was refused, 2 a usage problem. */
export function runInstall(argv, env) {
    const parsed = parseInstallArgs(argv);
    if (parsed.kind === 'usage') {
        env.printError(`${parsed.problem}\n${USAGE}`);
        return 2;
    }
    const report = installTeamrig({
        kitHome: kitHomeOf(env.teamrigHome, env.platform, env.home),
        platform: env.platform,
        nodePath: env.nodePath,
        hosts: parsed.hosts,
        write: parsed.write,
        exists: env.exists,
        rename: env.rename,
        cwd: env.cwd,
        stamp: folderStamp(env.now),
    }, env.run);
    report.lines.forEach((line) => (report.ok ? env.print(line) : env.printError(line)));
    return report.ok ? 0 : 1;
}
if (isEntry()) {
    process.exit(runInstall(process.argv.slice(2), {
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
    }));
}
