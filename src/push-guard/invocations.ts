import { packagedStartOf, type PackagedStart } from '../package-guard/packaged.ts';
import { isAssignmentWord, LineCommands, rereadingCommands } from './held-reread.ts';
import { isAssignment, launch, programName, staticWord, type Assignment, type Launch, type ProgramLaunch, type ScriptLaunch } from './launchers.ts';
import { bashNativeWord, Location, resolveDir } from './location.ts';
import { splitGitAlias } from './program-split.ts';
import { redirectsInput, stdinUse } from './stdin.ts';
import { parseHeldText, parseShell, type ShellCommand, type ShellDialect, type ShellParse, type ShellWord } from './tokenizer.ts';
import { resolveLiteralVariables } from './variables.ts';

/** One git config value: set, unset (git exits 1), or unreadable (git failed or is missing). */
export type ConfigValue = { readonly kind: 'set'; readonly value: string } | { readonly kind: 'unset' } | { readonly kind: 'unreadable' };

/** Reads git config as git in a folder sees it; the hook asks git, tests pass a fake. */
export interface GitConfigReader {
  config(dir: string, key: string): ConfigValue;
}

/** One git command a command line runs, after aliases are expanded. */
export interface GitInvocation {
  /** The folder git runs in, after `cd`, `-C`, `--git-dir` and `GIT_DIR`; undefined when it is only known when the line runs. */
  readonly dir: string | undefined;
  readonly subcommand: string;
  readonly args: readonly ShellWord[];
  /** True when `-c`, `--config-env` or a `GIT_CONFIG*` variable may change remotes, branches or push defaults. */
  readonly configOverride: boolean;
  /**
   * What may turn git's hooks off for this run, as written: `-c core.hooksPath=...` (or `--config-env`), a husky
   * switch (`HUSKY=0`, `HUSKY_SKIP_HOOKS`), or a `GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_KEY_<n>` that may set
   * `core.hooksPath`, set for git, for a shell or git that runs it, or earlier in its shell (whatever the value
   * there: the guard does not follow it). Absent when nothing does.
   */
  readonly hooksOverride?: string;
}

/** Why the guard cannot read part of a command line with confidence. */
export interface Doubt {
  /** A phrase that completes "the guard cannot tell whether this command pushes to a protected branch: ...". */
  readonly reason: string;
  /** True when it matters only on a command line that mentions a push anywhere; false when it always asks. */
  readonly gated: boolean;
}

/** Every git command a command line runs, in order, and what the guard could not read. */
export interface GitInvocations {
  readonly invocations: readonly GitInvocation[];
  readonly doubts: readonly Doubt[];
  /**
   * True when a word the line runs, or a script or alias it runs, names a push (see {@link saysPush}), or a
   * heredoc it does not store in a file does, or a part it cannot read says one. Comments and redirection
   * targets do not count.
   */
  readonly mentionsPush: boolean;
  /** Each place the line runs one of several readings of what a package runner starts, of which only one runs. */
  readonly readings: readonly ReadingSpan[];
}

/**
 * The git runs of the readings of what one package runner starts (see `packagedStartOf`), read one after another:
 * reading `n` runs from the end before it (`start` for the first) to `ends[n]`, as indexes into the invocations.
 * Only one reading runs, so what an earlier one moves is not known to hold in a later one, or after them all.
 */
export interface ReadingSpan {
  readonly start: number;
  readonly ends: readonly number[];
}

/** What is left of a line's nested reads; see {@link MAX_NESTED_READS}. */
interface ReadBudget {
  left: number;
}

export interface FinderContext {
  readonly cwd: string;
  /** The user's home folder, for `cd ~`. */
  readonly home: string;
  readonly dialect: ShellDialect;
  readonly git: GitConfigReader;
}

/** Git's own commands; an alias never overrides one. */
export const GIT_BUILTINS: ReadonlySet<string> = new Set(
  (
    'add am annotate apply archive backfill bisect blame branch bugreport bundle cat-file check-attr check-ignore check-mailmap ' +
    'check-ref-format checkout checkout-index cherry cherry-pick citool clean clone column commit commit-graph commit-tree config ' +
    'count-objects credential cvsexportcommit cvsimport cvsserver daemon describe diagnose diff diff-files diff-index diff-tree ' +
    'difftool fast-export fast-import fetch fetch-pack filter-branch fmt-merge-msg for-each-ref for-each-repo format-patch fsck gc ' +
    'get-tar-commit-id gitk grep gui hash-object help hook http-backend http-fetch http-push imap-send index-pack init instaweb ' +
    'interpret-trailers log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base merge-file merge-index ' +
    'merge-tree mergetool mktag mktree multi-pack-index mv name-rev notes p4 pack-objects pack-redundant pack-refs patch-id prune ' +
    'prune-packed pull push quiltimport range-diff read-tree rebase receive-pack reflog refs remote repack replace replay ' +
    'request-pull rerere reset restore rev-list rev-parse revert rm scalar send-email send-pack shortlog show show-branch show-index ' +
    'show-ref sparse-checkout stage stash status stripspace submodule subtree svn switch symbolic-ref tag unpack-file unpack-objects ' +
    'update-index update-ref update-server-info upload-archive upload-pack var verify-commit verify-pack verify-tag version ' +
    'whatchanged worktree write-tree'
  ).split(' '),
);
/** Git options that only print something and run no command. */
const GIT_INFO_OPTIONS: ReadonlySet<string> = new Set(['--help', '-h', '--version', '-v', '--html-path', '--man-path', '--info-path', '--exec-path']);
/** Git options that take a value, as the next word or after `=`. */
export const GIT_VALUED_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source']);
/** Config sections that change which remote branch a push updates. */
const PUSH_CONFIG = /^(?:remote|push|branch)\./i;
/** `git config` forms that read or remove, never set. */
const CONFIG_READS: ReadonlySet<string> = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l', '--remove-section', '--rename-section', '-e', '--edit']);
/** `git config` options that unset the key they name. */
const CONFIG_UNSETS: ReadonlySet<string> = new Set(['--unset', '--unset-all']);
const CONFIG_VALUED: ReadonlySet<string> = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);
const CONFIG_SUBCOMMANDS: ReadonlySet<string> = new Set(['get', 'list', 'unset', 'edit', 'rename-section', 'remove-section']);
const FILTER_OPTIONS: ReadonlySet<string> = new Set(['--setup', '--env-filter', '--tree-filter', '--index-filter', '--msg-filter', '--commit-filter', '--parent-filter', '--tag-name-filter']);

/** How deep scripts (`bash -c "eval ..."`) and git aliases may nest before the guard stops reading. */
const MAX_SCRIPT_DEPTH = 8;
const MAX_ALIAS_DEPTH = 8;
/**
 * How many nested commands one line may hand the guard to read (a runner's command, a held substitution). A runner's
 * command is read from each suffix of its words, so runners nested in runners cost more at each level; past this
 * the guard stops reading and refuses the line.
 */
const MAX_NESTED_READS = 1000;
const DIALECT_NAMES: Readonly<Record<ShellDialect, string>> = { bash: 'bash', powershell: 'PowerShell', cmd: 'cmd' };

/** Variables that move git to another repository; set in the shell earlier in the line, they move every later git command. */
const GIT_DIR_VARIABLES = /^GIT_(?:DIR|COMMON_DIR)$/i;
/** Variables that change the config git reads. */
const GIT_CONFIG_VARIABLES = /^GIT_CONFIG/i;
/** The config key that moves git's hooks folder; `-c`, `GIT_CONFIG*` and `git config` keys are matched lowercased. */
export const HOOKS_PATH_KEY = 'core.hookspath';
/**
 * The variables that may turn git's hooks off: husky's switches, which its hooks read (`HUSKY=0` from husky 5 on,
 * `HUSKY_SKIP_HOOKS` before), and those that may set `core.hooksPath`.
 */
const HOOKS_VARIABLES = /^(?:HUSKY|HUSKY_SKIP_HOOKS|GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+)$/i;
/** Bash builtins that set variables for the rest of the shell, such as `export GIT_DIR=x`. */
const BASH_SETTERS: ReadonlySet<string> = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);
/** PowerShell commands that set an `env:` item. */
const PS_ENV_SETTERS = /^(?:set-item|si|new-item|ni)$/i;
/** A word that stands for a value only known when the line runs, such as a `GIT_DIR` set earlier in the shell. */
const UNKNOWN_WORD: ShellWord = { text: '', dynamic: true };

/** The name `pattern` captures from a word, if any. */
const capturedName =
  (pattern: RegExp) =>
  (word: ShellWord): string[] => {
    const name = pattern.exec(word.text)?.[1];
    return name === undefined ? [] : [name];
  };

/**
 * The variables a command sets for the rest of its shell: bash `export X=1` or a bare `X=1`,
 * PowerShell `$env:X = 1` or `Set-Item env:X 1`, cmd `set X=1`. Variables a launcher sets for one
 * program (`X=1 git push`) are not here; see `launch`.
 */
export function shellVariables(words: readonly ShellWord[], dialect: ShellDialect): string[] {
  const [head, ...rest] = words;
  if (head === undefined) {
    return [];
  }
  const assigned = capturedName(/^([A-Za-z_]\w*)=/);
  switch (dialect) {
    case 'bash':
      if (BASH_SETTERS.has(head.text)) {
        return rest.flatMap(assigned);
      }
      return words.every((word) => isAssignment(word.text)) ? words.flatMap(assigned) : [];
    case 'powershell': {
      if (PS_ENV_SETTERS.test(head.text)) {
        return rest.flatMap(capturedName(/^env:\\?([A-Za-z_]\w*)$/i));
      }
      const target = /^\$env:([A-Za-z_]\w*)(\s*[-+*/]?=)?/i.exec(head.text);
      const assigns = target?.[2] !== undefined || /^[-+*/]?=/.test(rest[0]?.text ?? '');
      return target?.[1] !== undefined && assigns ? [target[1]] : [];
    }
    case 'cmd':
      return head.text.toLowerCase() === 'set' ? rest.flatMap(assigned) : [];
  }
}

/** What one git run inherits: its folder, whether config is overridden, and the aliases its `-c` options set. */
interface GitState {
  /** The folder git starts in, after `cd` and `-C`. */
  readonly dir: string | undefined;
  /** A `GIT_DIR` or `--git-dir`, which git resolves from {@link dir} after every `-C`; a dynamic word when only known when it runs. */
  readonly gitDir: ShellWord | undefined;
  readonly configOverride: boolean;
  /** Aliases from `-c alias.x=...`; undefined marks one whose value is only known when it runs. */
  readonly aliases: ReadonlyMap<string, string | undefined>;
  /** True when a `-c` or `GIT_CONFIG*` setting may define aliases the guard cannot read. */
  readonly aliasesUnknown: boolean;
  /** See {@link GitInvocation.hooksOverride}; undefined when nothing turns the hooks off. */
  readonly hooksOverride: string | undefined;
}

/**
 * A launcher's variable as written when it may turn git's hooks off: `HUSKY=0`, a non-empty `HUSKY_SKIP_HOOKS`, a
 * `GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_KEY_<n>` that names `core.hooksPath`, or one of them only known when it runs.
 */
function hooksVariable({ name, value }: Assignment): string | undefined {
  if (!HOOKS_VARIABLES.test(name)) {
    return undefined;
  }
  let off: boolean;
  if (value.dynamic) {
    off = true;
  } else if (GIT_CONFIG_VARIABLES.test(name)) {
    off = value.text.toLowerCase().includes(HOOKS_PATH_KEY);
  } else {
    off = name.toUpperCase() === 'HUSKY' ? value.text === '0' : value.text !== '';
  }
  return off ? `${name}=${value.text}` : undefined;
}

/** The first of `env` that may turn git's hooks off; see {@link hooksVariable}. */
function hooksVariableOf(env: readonly Assignment[]): string | undefined {
  return env.map(hooksVariable).find((setting) => setting !== undefined);
}

/** What a `git config` command writes: a key it sets, with the value, or one it unsets. */
export type ConfigWrite = { readonly kind: 'set'; readonly key: ShellWord; readonly value: ShellWord } | { readonly kind: 'unset'; readonly key: ShellWord };

/**
 * What `git config <args>` writes, in either form (`git config [--unset] key [value]` or `git config set|unset key
 * [value]`); undefined for a read, an edit, a section change or a line with no key.
 */
export function configWrite(args: readonly ShellWord[]): ConfigWrite | undefined {
  const operands: ShellWord[] = [];
  let unset = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? staticWord('');
    const [name, attached] = splitOption(word.text);
    if (CONFIG_READS.has(name)) {
      return undefined;
    }
    if (CONFIG_UNSETS.has(name)) {
      unset = true;
    } else if (word.text.startsWith('-')) {
      index += CONFIG_VALUED.has(name) && attached === undefined ? 1 : 0;
    } else {
      operands.push(word);
    }
  }
  const [first, ...rest] = operands;
  if (first?.text === 'unset') {
    const [key] = rest;
    return key === undefined ? undefined : { kind: 'unset', key };
  }
  if (first !== undefined && CONFIG_SUBCOMMANDS.has(first.text)) {
    return undefined;
  }
  const [key, value] = first?.text === 'set' ? rest : operands;
  if (key === undefined) {
    return undefined;
  }
  if (unset) {
    return { kind: 'unset', key };
  }
  return value === undefined ? undefined : { kind: 'set', key, value };
}

/** True when `word` is one of the variables a launcher sets for the shell it starts, as written. */
function setsFor(script: ScriptLaunch, word: ShellWord): boolean {
  return isAssignmentWord(word.text) && script.env.some(({ name, value }) => word.text === `${name}=${value.text}`);
}

/** Quotes a word for a bash command line, so a git shell alias gets its arguments as typed. */
function shellQuote(word: ShellWord): string {
  return word.dynamic ? word.text : `'${word.text.replace(/'/g, `'\\''`)}'`;
}

/** What ends a piece of text for {@link saysPush}: blanks, quotes, operators and path separators, but not `-` or `.`. */
const MENTION_BREAKS = /[\s'"`;&|()<>{}[\]$=!:,/\\@%^#?*+~]+/;
/** A piece of text that names git's push: `push`, `--push`, `git-push` or `git-push.exe`. */
const PUSH_WORD = /^-*(?:git-)?push(?:\.exe)?$/i;

/** True when `text` names a push as a word of its own: `git push` or `X=push` do, `push-guard/` or `x-push.log` do not. */
function saysPush(text: string): boolean {
  return text.split(MENTION_BREAKS).some((piece) => PUSH_WORD.test(piece));
}

/*
 * Programs that run a command the guard cannot follow: on another host or in a container, in a terminal or
 * multiplexer, later, or in parallel. The command they are handed is read as a bash script, as the shell at the
 * other end reads it, and is a doubt when it pushes.
 */
/** Container tools: only what follows their `exec`, `run`, `enter`, ... is a command (`docker push` pushes an image). */
const CONTAINER_TOOLS: ReadonlySet<string> = new Set(['docker', 'podman', 'nerdctl', 'kubectl', 'oc', 'lxc', 'toolbox', 'distrobox']);
const CONTAINER_COMMANDS: ReadonlySet<string> = new Set(['exec', 'run', 'debug', 'enter', 'ssh']);
/** Programs that run a command from their arguments. */
const ARGUMENT_RUNNERS: ReadonlySet<string> = new Set([
  ...['ssh', 'sshpass', 'mosh', 'watch', 'tmux', 'screen', 'byobu', 'dtach', 'zellij', 'wezterm', 'parallel'],
  ...['xterm', 'gnome-terminal', 'konsole', 'kitty', 'alacritty', 'xfce4-terminal', 'make', ...CONTAINER_TOOLS],
]);
/** awk runs a command only through `system(...)` or a pipe to or from a quoted command. */
const AWK_RUNS = /system\s*\(|\|\s*"|"\s*\|/;
const AWKS: ReadonlySet<string> = new Set(['awk', 'gawk', 'mawk', 'nawk']);
/**
 * expect's script is Tcl, not bash: a program starts through `spawn`, Tcl's `exec` or expect's `system`, whose
 * words up to the end of the Tcl command are read as a bash line.
 */
const TCL_RUNS = /(?:^|[;\n[{])\s*(?:spawn|exec|system)\s+(?:-\S+\s+)*([^;\n\]}]*)/g;
/** Programs that run commands they read on stdin; `make`, `docker` and `podman` only in some forms (see {@link runsStdin}). */
const STDIN_RUNNERS: ReadonlySet<string> = new Set(['ssh', 'at', 'batch', 'crontab', 'parallel', 'kubectl']);
/** A file name that is the program's own stdin. */
const STDIN_PATH = /^(?:-|\/dev\/stdin|\/dev\/fd\/0|\/proc\/(?:self|thread-self|\d+)\/fd\/0)$/;
/** GNU make's short options that take a value (`C:E:f:I:o:W:`) and those whose value can only be attached (`j::l::O::`). */
const MAKE_VALUED_LETTERS = 'CEfIoW';
const MAKE_ATTACHED_LETTERS = 'jlO';
/** `--file` and `--makefile`, and the prefixes getopt_long takes for them. */
const MAKE_FILE_OPTION = /^--(?:fi|fil|file|makef|makefi|makefil|makefile)(?:=(.*))?$/s;
/**
 * The makefiles a `make` line names: `-f F`, `-fF`, `-sf F` (a bundle of short options, as getopt reads it),
 * `--file F`, `--file=F` and their prefixes. A word with a variable in it stands for its unknown value.
 */
function makefileWords(args: readonly ShellWord[]): ShellWord[] {
  const files: ShellWord[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? staticWord('');
    const long = MAKE_FILE_OPTION.exec(word.text);
    if (long !== null) {
      const value = long[1] === undefined ? args[(index += 1)] : { text: long[1], dynamic: word.dynamic };
      if (value !== undefined) files.push(value);
      continue;
    }
    if (!/^-[^-]/.test(word.text)) continue;
    for (let at = 1; at < word.text.length; at += 1) {
      const letter = word.text[at] ?? '';
      if (MAKE_ATTACHED_LETTERS.includes(letter)) break;
      if (!MAKE_VALUED_LETTERS.includes(letter)) continue;
      const rest = word.text.slice(at + 1);
      const value = rest === '' ? args[(index += 1)] : { text: rest, dynamic: word.dynamic };
      if (letter === 'f' && value !== undefined) files.push(value);
      break;
    }
  }
  return files;
}

/** docker and podman options before the subcommand that take a value as the next word. */
const CONTAINER_GLOBAL_VALUED: ReadonlySet<string> = new Set([
  ...['--config', '-c', '--context', '-H', '--host', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey'],
  ...['--connection', '--url', '--identity', '--root', '--runroot', '--storage-driver', '--storage-opt', '--runtime'],
  ...['--cgroup-manager', '--tmpdir', '--events-backend', '--hooks-dir', '--module', '--network-cmd-path', '--conmon'],
  ...['--imagestore', '--ssh', '--volumepath', '--out', '--db-backend', '--cni-config-dir', '--remote'],
]);
/**
 * docker and podman commands that read stdin as data only: an image or tar stream, a password, a secret's or
 * config's value. Every other command may read code there (a compose, stack or build file names commands to run).
 */
const CONTAINER_DATA_COMMANDS = /^(?:load|import|cp|login|(?:image|container) (?:load|import|cp)|(?:secret|config) create)(?: |$)/;

/** The subcommand words of a docker or podman line, after its global options. */
function containerCommand(args: readonly ShellWord[]): string {
  let index = 0;
  while (index < args.length && (args[index]?.text ?? '').startsWith('-')) {
    index += CONTAINER_GLOBAL_VALUED.has(args[index]?.text ?? '') ? 2 : 1;
  }
  return args
    .slice(index, index + 2)
    .map((arg) => (arg.dynamic ? '$' : arg.text))
    .join(' ');
}

/**
 * True when `name` runs what it reads on stdin as commands: a {@link STDIN_RUNNERS} program, `make` given its
 * makefile on stdin (`-f -`, `-sf /dev/fd/0`, a makefile word with a variable in it), and `docker` or `podman`
 * in any command but a data-only one ({@link CONTAINER_DATA_COMMANDS}), so `| docker load` or `| make` reads no code.
 */
function runsStdin(name: string, args: readonly ShellWord[]): boolean {
  if (name === 'make') {
    return makefileWords(args).some((file) => file.dynamic || STDIN_PATH.test(file.text));
  }
  if (name === 'docker' || name === 'podman') {
    return !CONTAINER_DATA_COMMANDS.test(containerCommand(args));
  }
  return STDIN_RUNNERS.has(name);
}
/**
 * The OpenSSH programs that take `-o` config lines, with the option letters each takes a value for (from each
 * program's getopt string). A config line can name a command the user's shell runs on this host
 * (`ProxyCommand`, `LocalCommand`, `KnownHostsCommand`, `Match exec`) or on the other end (`RemoteCommand`).
 */
const SSH_VALUED_LETTERS: Readonly<Record<string, string>> = { ssh: 'BbcDEeFIiJLlmOPpQRSWw', scp: 'cDFiJlPSX', sftp: 'BbcDFiJlPRSsX' };
const SSH_COMMAND_OPTION = /^\s*(?:proxycommand|localcommand|knownhostscommand|remotecommand)(?:\s*=\s*|\s+)(.*)$/is;
const SSH_MATCH_EXEC = /\bexec\s+(?:"((?:[^"\\]|\\.)*)"|(\S+))/gi;
/** The most argument words a runner's command is looked for in, each suffix read on its own. */
const MAX_RUNNER_WORDS = 24;
/** A pipe to the next command, maybe after the newline that ends a heredoc's line. */
const PIPE_TERMINATOR = /^\|&?\n*$/;
/** Variables whose value a shell runs as commands later: before a prompt, at its start, or in a prompt. */
const CODE_VARIABLES = /^(?:PROMPT_COMMAND|BASH_ENV|ENV|PS[0124])(?:\[[^\]]*\])?\+?=/;
/**
 * A file whose text a later shell or git runs: a shell's startup file or a folder of them (`~/.bashrc.d/`,
 * `/etc/profile.d/`, fish's config and autoloaded functions), a git hook (of a bare `repo.git` too) or a husky one, a systemd user unit, an autostart entry, direnv's
 * `.envrc`. Only these folders count, so a project's own `src/hooks/` is data.
 */
const LATER_CODE_FILE =
  /(?:^|\/)(?:\.(?:bashrc|bash_profile|bash_login|bash_logout|bash_aliases|profile|zshrc|zprofile|zshenv|zlogin|zlogout|kshrc|mkshrc|envrc)|etc\/profile|bash\.bashrc|environment|fish\/config\.fish)$|(?:^|\/)(?:\.bashrc\.d|\.zshrc\.d|profile\.d|fish\/(?:conf\.d|functions)|\.husky|systemd\/user|(?:\.config|xdg)\/autostart)\/|\.git\/hooks\//;
/** A redirection that writes its file: `>`, `>>`, `>|`, `&>`, `&>>`, with a descriptor number or not. */
const WRITE_REDIRECTION = /^(?:\d*|&)>[>|]?$/;

/** The arguments of an {@link ARGUMENT_RUNNERS} program that may hold the command it runs. */
function runnerArgs(name: string, args: readonly ShellWord[]): readonly ShellWord[] {
  if (CONTAINER_TOOLS.has(name)) {
    const at = args.findIndex((arg) => CONTAINER_COMMANDS.has(arg.text));
    return at === -1 ? [] : args.slice(at + 1);
  }
  if (name === 'make') {
    // Only `--eval` text is a makefile of the line's own; a recipe from a file is the file's.
    return args.flatMap((arg, index) => {
      if (arg.text === '-E' || arg.text === '--eval') {
        const value = args[index + 1];
        return value === undefined ? [] : [value];
      }
      const attached = /^(?:-E|--eval=)(.+)$/s.exec(arg.text);
      return attached === null ? [] : [{ text: attached[1] ?? '', dynamic: arg.dynamic }];
    });
  }
  return args;
}

/** The bash lines an expect (Tcl) script starts; see {@link TCL_RUNS}. */
function tclCommands(script: ShellWord): ShellWord[] {
  return [...script.text.matchAll(TCL_RUNS)].map((match) => ({ text: match[1] ?? '', dynamic: script.dynamic }));
}

/**
 * The commands `-o` config lines hand an OpenSSH program (see {@link SSH_VALUED_LETTERS}), each a bash line:
 * `-o ProxyCommand=<c>`, `-o 'ProxyCommand <c>'`, `-oProxyCommand=<c>`, `-vo ...`, `-o 'Match exec "<c>"'`.
 * Options after the host are read too, as ssh reads them, up to `--`.
 */
function sshOptionCommands(args: readonly ShellWord[], valued: string): ShellWord[] {
  const commands: ShellWord[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? staticWord('');
    if (word.text === '--') {
      break;
    }
    if (!/^-[^-]/.test(word.text)) {
      continue;
    }
    let value: ShellWord | undefined;
    for (let at = 1; at < word.text.length; at += 1) {
      const letter = word.text[at] ?? '';
      if (letter !== 'o' && !valued.includes(letter)) {
        continue;
      }
      const rest = word.text.slice(at + 1);
      const optionValue = rest === '' ? args[(index += 1)] : { text: rest, dynamic: word.dynamic };
      value = letter === 'o' ? optionValue : undefined;
      break;
    }
    if (value === undefined) {
      continue;
    }
    const setting = SSH_COMMAND_OPTION.exec(value.text);
    if (setting !== null) {
      commands.push({ text: setting[1] ?? '', dynamic: value.dynamic });
    } else if (/^\s*match\b/i.test(value.text)) {
      commands.push(...[...value.text.matchAll(SSH_MATCH_EXEC)].map((match) => ({ text: (match[1] ?? match[2] ?? '').replace(/\\(.)/g, '$1'), dynamic: value.dynamic })));
    }
  }
  return commands;
}

/**
 * The commands of a crontab read on stdin: each entry without its schedule (five time fields, or one `@reboot`,
 * `@daily`, ...). Blank lines, comments, variables and lines too short to hold a schedule are kept as written.
 */
function cronCommands(table: ShellWord): ShellWord {
  const text = table.text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('#') || isAssignment(trimmed.split(/\s/)[0] ?? '') ? trimmed : trimmed.replace(/^(?:@\S+\s+|(?:\S+\s+){5})/, '');
    })
    .join('\n');
  return { text, dynamic: table.dynamic };
}

/**
 * What a static `echo` or `printf` writes down a pipe, so the program the pipe feeds is handed that text; undefined
 * for any other command, or one that writes nothing down the pipe (`printf -v`). Escapes are not followed, except a
 * `\n`, read as the newline it may write.
 */
function echoedText(words: readonly ShellWord[]): ShellWord | undefined {
  const [head, ...rest] = words;
  const name = head === undefined ? '' : programName(head.text);
  let args = rest;
  if (name === 'echo') {
    while (args[0] !== undefined && /^-[neE]+$/.test(args[0].text)) {
      args = args.slice(1);
    }
  } else if (name === 'printf') {
    if (args[0]?.text.startsWith('-v') === true) {
      return undefined;
    }
    args = args[0]?.text === '--' ? args.slice(1) : args;
  } else {
    return undefined;
  }
  return { text: args.map((arg) => arg.text.replace(/\\n/g, '\n')).join(' '), dynamic: args.some((arg) => arg.dynamic) };
}

/** The literal strings of an awk program: the commands its `system(...)` or pipes may run. */
function awkStrings(program: string): ShellWord[] {
  return [...program.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => staticWord((match[1] ?? '').replace(/\\(.)/g, '$1')));
}

/** Words joined into one command line, as written (`ssh`, `watch`) or quoted word by word (an argv program). */
function joinedLine(words: readonly ShellWord[], quote: boolean): ShellWord {
  return { text: words.map((word) => (quote ? shellQuote(word) : word.text)).join(' '), dynamic: words.some((word) => word.dynamic) };
}

/** Why `parsed` may not hold every command its line runs; undefined when it does. */
function unreadReason(parsed: ShellParse): string | undefined {
  if (parsed.complete) {
    return undefined;
  }
  return parsed.readings?.every((reading) => reading.complete) === true
    ? "its words differ by the shell's version, its host or how it is started"
    : 'part of it cannot be read, as a quote, bracket or substitution never closes';
}

/** Splits `--option=value` into its name and attached value. */
function splitOption(text: string): readonly [string, string | undefined] {
  const equals = text.startsWith('--') ? text.indexOf('=') : -1;
  return equals === -1 ? [text, undefined] : [text.slice(0, equals), text.slice(equals + 1)];
}

/**
 * Finds every git command a command line runs. It reads the line as its shell would (see `parseShell`),
 * follows `cd` and friends, sees through launchers (see `launch`) into nested scripts, reads git's global
 * options, and expands git aliases (from `-c`, from a `git config alias.x` earlier in the line, or from git
 * config), including `!` shell aliases. Commands git itself runs (`submodule foreach`, `rebase --exec`,
 * `bisect run`, `filter-branch` filters) are read too. Whatever it cannot read becomes a {@link Doubt}.
 */
class GitInvocationFinder {
  private readonly invocations: GitInvocation[] = [];
  private readonly doubts: Doubt[] = [];
  private readonly readings: ReadingSpan[] = [];
  private mentionsPush = false;
  /** Aliases a `git config alias.x value` earlier in the line sets; undefined marks one only known when it runs. */
  private readonly lineAliases = new Map<string, string | undefined>();
  /** True once the line sets a `GIT_DIR`-like variable in its shell, so later git commands run in a repository the guard cannot place. */
  private shellMovesRepo = false;
  /** True once the line sets a `GIT_CONFIG*` variable in its shell. */
  private shellOverridesConfig = false;
  /**
   * What turns git's hooks off for every git run of the shell being read: a hooks variable (see `HOOKS_VARIABLES`)
   * set in it earlier in the line, or one its launcher or parent git set, which a child shell inherits.
   */
  private shellHooksOverride: string | undefined;
  /** The functions, aliases and loaded builtins of every bash script the line runs, which may run their arguments as code. */
  private readonly lineCommands = new LineCommands();
  private readonly context: FinderContext;
  /** The nested reads left to the whole line, shared with every finder it starts (see {@link MAX_NESTED_READS}). */
  private readonly budget: ReadBudget;

  constructor(context: FinderContext, budget: ReadBudget = { left: MAX_NESTED_READS }) {
    this.context = context;
    this.budget = budget;
  }

  find(command: string): GitInvocations {
    this.visitScript(staticWord(command), this.context.dialect, new Location(this.context.cwd, this.context.home), 0);
    if (this.budget.left < 0) {
      this.doubt('it nests more commands than the guard reads in one line', false);
    }
    return { invocations: this.invocations, doubts: this.doubts, mentionsPush: this.mentionsPush, readings: this.readings };
  }

  /**
   * Takes one nested read from the line's budget; false once it is spent, and the line is then refused (see
   * {@link find}), so what is left unread never passes.
   */
  private spendRead(): boolean {
    this.budget.left -= 1;
    return this.budget.left >= 0;
  }

  private doubt(reason: string, gated: boolean): void {
    this.doubts.push({ reason, gated });
  }

  private mention(text: string): void {
    this.mentionsPush ||= saysPush(text);
  }

  /**
   * Visits each command of a script in order. A heredoc or here-string is its command's stdin, and a plain
   * `cat` hands its stdin down a pipe to the next command, so `cat <<EOF | bash` runs the body as commands.
   */
  private visitScript(script: ShellWord, dialect: ShellDialect, location: Location, depth: number): void {
    const parsed = parseShell(script.text, dialect);
    this.visitParsed(parsed, script.text, unreadReason(parsed), dialect, location, depth);
  }

  /**
   * Visits the commands parsed from `source` in order; see {@link visitScript}. `unread` is the doubt when the
   * parse may not hold every command `source` runs.
   */
  private visitParsed(parsed: ShellParse, source: string, unread: string | undefined, dialect: ShellDialect, location: Location, depth: number): void {
    if (depth > MAX_SCRIPT_DEPTH) {
      this.doubt('scripts nest too deep to read', false);
      return;
    }
    if (unread !== undefined) {
      this.doubt(unread, true);
      this.mention(source);
    }
    parsed.unreadBodies.forEach((body) => this.mention(body.text));
    // bash reads $NAME set to a literal earlier in the line; other dialects keep every variable unknown. The
    // line's own shell has the user's HOME; a script it starts may be handed another (`HOME=x bash -c`).
    const commands = dialect === 'bash' ? resolveLiteralVariables(parsed, depth === 0 ? location.home : undefined) : parsed.commands;
    const rereading = dialect === 'bash' ? this.rereading(commands) : [];
    let piped: { readonly body: ShellWord; readonly nesting: number } | undefined;
    let pipeAt: number | undefined;
    // What a static echo or printf before the pipe writes into it.
    let pipeText: ShellWord | undefined;
    for (const [index, command] of commands.entries()) {
      command.words.forEach((word) => this.mention(word.text));
      let stdin = command.stdin;
      // A substitution's commands, read before the command that holds them, sit between a pipe's two ends.
      if (piped !== undefined && command.nesting <= piped.nesting) {
        stdin ??= command.nesting === piped.nesting && !redirectsInput(command) ? piped.body : undefined;
        piped = undefined;
      }
      const fedByPipe = pipeAt === command.nesting && !redirectsInput(command);
      const fedText = fedByPipe ? pipeText : undefined;
      if (pipeAt !== undefined && command.nesting <= pipeAt) {
        pipeAt = undefined;
        pipeText = undefined;
      }
      if (PIPE_TERMINATOR.test(command.terminator)) {
        pipeAt = command.nesting;
        pipeText = command.redirections.some((redirection) => WRITE_REDIRECTION.test(redirection.operator)) ? undefined : echoedText(command.words);
      }
      location.enter(command.subshells);
      if (dialect === 'bash') {
        this.noteLaterCode(command, stdin, location, depth);
      }
      const launched = this.visitCommand(command.words, dialect, location, depth, stdin, fedByPipe, fedText);
      this.visitHeld(command, launched, rereading[index] ?? true, location, depth);
      if (stdin !== undefined) {
        const use = launched === undefined ? 'read' : stdinUse(command, launched);
        if (use !== 'stored') {
          this.mention(stdin.text);
        }
        piped = use === 'passed' ? { body: stdin, nesting: command.nesting } : undefined;
      }
    }
  }

  /**
   * Notes the commands a bash parse defines, then tells for each command whether bash may read its words' held text
   * again (see {@link rereadingCommands}); a parse with no held text needs no answer.
   */
  private rereading(commands: readonly ShellCommand[]): readonly boolean[] {
    this.lineCommands.note(commands);
    return commands.some((command) => command.words.some((word) => word.held !== undefined)) ? rereadingCommands(commands, this.lineCommands) : [];
  }

  /**
   * Reads the command substitutions a command's words hold as text (see `ShellWord.held`), which bash runs when an
   * expansion reads the text again, in this line or a later one the guard never sees. One that pushes is a doubt in
   * any word, as some programs run quoted backticks in their own code (`perl -e`, `ruby -e`): the push is not judged as
   * written, as nothing on the line says when it runs. The gated doubts reading it raises (text left unread, a shell
   * with no stdin, a git command built at run time) count only in an assignment word and where bash may read it again,
   * `rereads` (see {@link rereadingCommands}): a plain argument of another program, such as a perl or sed regex, is
   * data (#1471). Text that only never closes, such as a grep pattern's escaped backtick, still shows every
   * substitution bash runs there (see {@link parseHeldText}).
   */
  private visitHeld(command: ShellCommand, launched: Launch | undefined, rereads: boolean, location: Location, depth: number): void {
    const script = launched?.kind === 'script' ? launched : undefined;
    for (const word of command.words) {
      // A shell that runs a word as a script reads its substitutions as commands already; the variables set for it
      // (`PS4='...' bash -xc`) are values it may read again.
      if (word.held === undefined || (script !== undefined && !setsFor(script, word))) {
        continue;
      }
      this.readHeld(word.held, rereads || isAssignmentWord(word.text), location, depth);
    }
  }

  /**
   * Reads one word's held text; see {@link visitHeld}. A push in it always asks, ungated, as it may come through an
   * alias (`'$(git p)'`) where no word of the line says push.
   */
  private readHeld(text: string, rereads: boolean, location: Location, depth: number): void {
    if (!this.spendRead()) {
      return;
    }
    const parsed = parseHeldText(text);
    const unread = parsed.skipped ? 'it holds quoted text the guard cannot read for the commands bash runs if an expansion reads it again' : undefined;
    const held = new GitInvocationFinder(this.context, this.budget);
    held.visitParsed(parsed, text, unread, 'bash', location.child(), depth + 1);
    this.doubts.push(...held.doubts.filter((doubt) => rereads || !doubt.gated));
    if (held.invocations.some((invocation) => invocation.subcommand === 'push')) {
      this.doubt('it holds a quoted command substitution that pushes, which bash runs if an expansion reads it again', false);
    }
  }

  /**
   * Visits one simple command, given what it reads on stdin from the line, and when a pipe feeds it, what a static
   * echo or printf writes into that pipe; returns what it starts, or undefined for a `cd`.
   */
  private visitCommand(words: readonly ShellWord[], dialect: ShellDialect, location: Location, depth: number, stdin?: ShellWord, fedByPipe = false, pipeText?: ShellWord): Launch | undefined {
    for (const name of shellVariables(words, dialect)) {
      this.shellMovesRepo ||= GIT_DIR_VARIABLES.test(name);
      this.shellOverridesConfig ||= GIT_CONFIG_VARIABLES.test(name);
      this.shellHooksOverride ??= HOOKS_VARIABLES.test(name) ? `${name} set in its shell` : undefined;
    }
    if (location.apply(words, dialect)) {
      return undefined;
    }
    const launched = launch(words, dialect, stdin);
    switch (launched.kind) {
      case 'nothing':
        break;
      case 'opaque':
        this.doubt(launched.reason, launched.gated);
        break;
      case 'script': {
        const inner = location.child();
        launched.chdirs.forEach((chdir) => inner.moveTo(chdir, dialect));
        if (launched.script.dynamic && launched.dialect !== dialect) {
          this.doubt(`it hands ${DIALECT_NAMES[launched.dialect]} a command line built from ${DIALECT_NAMES[dialect]} variables`, true);
        }
        this.inheriting(hooksVariableOf(launched.env), launched.sameShell, () => this.visitScript(launched.script, launched.dialect, inner, depth + 1));
        if (launched.sameShell) {
          location.adopt(inner);
        }
        break;
      }
      case 'program': {
        const name = programName(launched.program.text);
        const packaged = packagedStartOf(name, launched.args, launched.env);
        if (packaged.length > 0) {
          this.visitPackaged(packaged, launched, dialect, location, depth, stdin);
          break;
        }
        this.visitRunner(name, launched.args, stdin ?? pipeText, fedByPipe, location, depth);
        const subcommand = name.startsWith('git-') ? name.slice(4) : undefined;
        if (name !== 'git' && (subcommand === undefined || !GIT_BUILTINS.has(subcommand))) {
          break;
        }
        const inner = location.child();
        launched.chdirs.forEach((chdir) => inner.moveTo(chdir, dialect));
        const words = dialect === 'bash' ? launched.args.map((word) => bashNativeWord(word, location.home)) : launched.args;
        const args = subcommand === undefined ? words : [staticWord(subcommand), ...words];
        const tail = launched.stdinArgs ? [...args, { text: '<stdin>', dynamic: true }] : args;
        this.visitGit(tail, this.gitState(inner.dir, launched.env), depth, 0);
      }
    }
    return launched;
  }

  /**
   * Doubts a program that runs a command the guard cannot follow (see {@link ARGUMENT_RUNNERS},
   * {@link runsStdin}) when the command it is handed pushes, read as the bash script the other end runs; a
   * pipe that feeds one commands is a doubt on a line that names a push. Since a runner's options and host
   * come before its command, each suffix of its arguments is read, joined as written and quoted word by word.
   * The awk and expect scripts and the compose, stack or build file docker reads on stdin, which are not bash,
   * also ask when they name a push anywhere.
   */
  private visitRunner(name: string, args: readonly ShellWord[], stdin: ShellWord | undefined, fedByPipe: boolean, location: Location, depth: number): void {
    const awk = AWKS.has(name);
    const expect = name === 'expect';
    const programs = awk ? args.filter((arg) => AWK_RUNS.test(arg.text)) : [];
    // A compose, stack or build file docker or podman reads on stdin names its commands in YAML or a Dockerfile.
    const containerFile = (name === 'docker' || name === 'podman') && stdin !== undefined && runsStdin(name, args) ? [stdin] : [];
    // Scripts in a language of the runner's own, read for the commands they start and searched for a push.
    const scripts = expect ? [...args, ...(stdin === undefined ? [] : [stdin])] : [...programs, ...containerFile];
    const lines: ShellWord[] = [];
    if (awk) {
      programs.forEach((program) => lines.push(...awkStrings(program.text)));
    } else if (expect) {
      scripts.forEach((script) => lines.push(...tclCommands(script)));
    } else if (ARGUMENT_RUNNERS.has(name)) {
      const words = runnerArgs(name, args).slice(0, MAX_RUNNER_WORDS);
      for (let from = 0; from < words.length; from += 1) {
        const suffix = words.slice(from);
        lines.push(joinedLine(suffix, false), ...(suffix.length > 1 ? [joinedLine(suffix, true)] : []));
      }
    }
    const sshLetters = SSH_VALUED_LETTERS[name];
    if (sshLetters !== undefined) {
      lines.push(...sshOptionCommands(args, sshLetters));
    }
    // awk running a command it builds (`system($0)`) runs what it reads; expect reads its script there.
    const readsStdin = runsStdin(name, args) || programs.length > 0 || expect;
    if (readsStdin && stdin !== undefined && !expect) {
      lines.push(name === 'crontab' ? cronCommands(stdin) : stdin);
    }
    if (this.handedPush(lines, location, depth) || scripts.some((script) => saysPush(script.text))) {
      this.doubt(`it hands ${name} a command that pushes, which ${name} runs where the guard cannot read it`, false);
    } else if (lines.some((line) => line.dynamic)) {
      this.doubt(`it hands ${name} a command only known when it runs`, true);
    } else if (readsStdin && stdin === undefined && fedByPipe) {
      this.doubt(`it pipes commands into ${name}, which runs them where the guard cannot read them`, true);
    }
  }

  /**
   * True when one of `lines`, read as a bash script, pushes or hands a runner of its own a push (`sshpass ...
   * ssh host '...'`). A line only known when it runs is left to the caller.
   */
  private handedPush(lines: readonly ShellWord[], location: Location, depth: number): boolean {
    if (depth >= MAX_SCRIPT_DEPTH) {
      return lines.length > 0;
    }
    return lines.some((line) => {
      if (line.dynamic || line.text.trim() === '' || !this.spendRead()) {
        return false;
      }
      const handed = new GitInvocationFinder(this.context, this.budget);
      handed.visitScript(staticWord(line.text), 'bash', location.child(), depth + 1);
      return handed.invocations.some((invocation) => invocation.subcommand === 'push') || handed.doubts.some((doubt) => !doubt.gated);
    });
  }

  /**
   * Doubts code a later shell or git runs, when it pushes: text written into a startup file, hook or unit (see
   * {@link LATER_CODE_FILE}) by a redirection or `tee`, a variable a shell runs as commands (`PROMPT_COMMAND`,
   * `BASH_ENV`, a prompt), or an alias.
   */
  private noteLaterCode(command: ShellCommand, stdin: ShellWord | undefined, location: Location, depth: number): void {
    const { words } = command;
    const head = words[0] === undefined ? '' : programName(words[0].text);
    const targets = [
      ...command.redirections.filter((redirection) => WRITE_REDIRECTION.test(redirection.operator)).flatMap((redirection) => (redirection.target === undefined ? [] : [redirection.target])),
      ...(head === 'tee' ? words.slice(1).filter((word) => !word.text.startsWith('-')) : []),
    ];
    if (targets.some((target) => LATER_CODE_FILE.test(target.text))) {
      // What lands in the file: the heredoc or here-string, or what echo or printf writes.
      const written = [...(stdin === undefined ? [] : [stdin]), joinedLine(words.slice(1), false)];
      if (this.handedPush(written, location, depth) || written.some((text) => text.dynamic && saysPush(text.text))) {
        this.doubt('it writes a push into a file a later shell or git runs', false);
      }
    }
    const alias = head === 'alias';
    for (const word of words) {
      if (CODE_VARIABLES.test(word.text) || (alias && /^[^=\s]+=/.test(word.text))) {
        const value = { text: word.text.slice(word.text.indexOf('=') + 1), dynamic: word.dynamic };
        // A value with a variable in it (`PROMPT_COMMAND="$PROMPT_COMMAND; ..."`) is only partly known: its words ask.
        if (this.handedPush([value], location, depth) || (value.dynamic && saysPush(value.text))) {
          this.doubt(alias ? 'it defines an alias that pushes, which a later command may run' : 'it sets a variable a shell runs as commands later to a push', false);
        }
      }
    }
  }

  /**
   * Visits what a package runner or a version manager starts (T3069): `git push` in `npx -c "git push"` or
   * `volta run git push` runs as surely as a line's own. It runs one script level deeper, in the runner's folder,
   * with its variables and stdin. Each reading of it is visited in turn, and kept as a {@link ReadingSpan} when
   * there are several; a shell the line names for it that the guard cannot read always asks.
   */
  private visitPackaged(starts: readonly PackagedStart[], runner: ProgramLaunch, dialect: ShellDialect, location: Location, depth: number, stdin: ShellWord | undefined): void {
    if (depth >= MAX_SCRIPT_DEPTH) {
      this.doubt('package runners nest too deep to read', false);
      return;
    }
    const start = this.invocations.length;
    const ends: number[] = [];
    for (const packaged of starts) {
      const inner = location.child();
      runner.chdirs.forEach((chdir) => inner.moveTo(chdir, dialect));
      this.visitPackagedReading(packaged, runner, dialect, inner, depth, stdin);
      ends.push(this.invocations.length);
    }
    if (ends.length > 1) {
      this.readings.push({ start, ends });
    }
  }

  /** Visits one reading of what a package runner starts, in `inner`, its folder. */
  private visitPackagedReading(start: PackagedStart, runner: ProgramLaunch, dialect: ShellDialect, inner: Location, depth: number, stdin: ShellWord | undefined): void {
    switch (start.kind) {
      case 'script':
        if (start.script.dynamic && start.dialect !== dialect) {
          this.doubt(`it hands ${DIALECT_NAMES[start.dialect]} a command line built from ${DIALECT_NAMES[dialect]} variables`, true);
        }
        this.inheriting(hooksVariableOf(runner.env), false, () => this.visitScript(start.script, start.dialect, inner, depth + 1));
        return;
      case 'foreign-shell':
        this.doubt(start.shell.dynamic ? 'a package runner hands its command line to a shell only known when it runs' : `a package runner hands its command line to ${programName(start.shell.text)}, a shell the guard cannot read`, false);
        return;
      case 'words': {
        // The runner's variables reach the program it starts, so `GIT_DIR=x npx git push` still moves git.
        const env = runner.env.map(({ name, value }) => ({ text: `${name}=${value.text}`, dynamic: value.dynamic }));
        this.visitCommand(env.length === 0 ? start.words : [staticWord('env'), ...env, ...start.words], dialect, inner, depth + 1, stdin);
      }
    }
  }

  /**
   * Runs `visit`, a read of a script whose shell inherits `hooksOverride` (from its launcher's variables or the git
   * that runs it) on top of its parent's. A child shell's own settings end with it; one in the same shell stays.
   */
  private inheriting(hooksOverride: string | undefined, sameShell: boolean, visit: () => void): void {
    const parent = this.shellHooksOverride;
    this.shellHooksOverride ??= hooksOverride;
    visit();
    if (!sameShell) {
      this.shellHooksOverride = parent;
    }
  }

  /**
   * What a git run inherits from its shell and from the variables its launcher sets: `GIT_DIR` moves it,
   * `GIT_CONFIG*` overrides config, a hooks variable may turn its hooks off. One set in the shell earlier in the
   * line is treated as unknown: the guard resolves an earlier literal only where a word reads it (`$NAME`), never
   * in the environment git inherits.
   */
  private gitState(dir: string | undefined, env: readonly Assignment[]): GitState {
    let gitDir = this.shellMovesRepo ? UNKNOWN_WORD : undefined;
    let overridden = this.shellOverridesConfig;
    for (const { name, value } of env) {
      if (GIT_DIR_VARIABLES.test(name)) {
        gitDir = name.toUpperCase() === 'GIT_DIR' ? value : UNKNOWN_WORD;
      }
      overridden ||= GIT_CONFIG_VARIABLES.test(name);
    }
    const hooksOverride = hooksVariableOf(env) ?? this.shellHooksOverride;
    return { dir, gitDir, configOverride: overridden, aliases: new Map(), aliasesUnknown: overridden, hooksOverride };
  }

  /** The folder git runs in: its `-C` folder, moved to its git dir when it has one. */
  private repoDir(state: Pick<GitState, 'dir' | 'gitDir'>): string | undefined {
    const { dir, gitDir } = state;
    if (gitDir === undefined) {
      return dir;
    }
    return gitDir.dynamic ? undefined : resolveDir(dir, gitDir.text, this.context.home);
  }

  /** Reads git's global options, then runs the subcommand: a builtin, or an alias to expand. */
  private visitGit(words: readonly ShellWord[], start: GitState, depth: number, aliasDepth: number): void {
    let { dir, gitDir, configOverride, aliasesUnknown, hooksOverride } = start;
    const aliases = new Map(start.aliases);
    let index = 0;
    for (; index < words.length; index += 1) {
      const word = words[index] ?? staticWord('');
      if (!word.text.startsWith('-')) {
        break;
      }
      const [name, attached] = splitOption(word.text);
      if (word.dynamic && /[$`%@(]/.test(name)) {
        break;
      }
      if (GIT_INFO_OPTIONS.has(name) && attached === undefined) {
        return;
      }
      if (!GIT_VALUED_OPTIONS.has(name)) {
        continue;
      }
      const value = attached === undefined ? words[(index += 1)] : { text: attached, dynamic: word.dynamic };
      if (value === undefined) {
        return;
      }
      if (name === '-C') {
        dir = value.dynamic ? undefined : value.text === '' ? dir : resolveDir(dir, value.text, this.context.home);
      } else if (name === '--git-dir') {
        gitDir = value;
      } else if (name === '-c' || name === '--config-env') {
        const setting = /^([A-Za-z][\w.-]*)(?:=(.*))?$/s.exec(value.text);
        const key = setting?.[1]?.toLowerCase();
        if (key === undefined || (value.dynamic && /[$`%]/.test(key))) {
          configOverride = true;
          aliasesUnknown = true;
          hooksOverride ??= `${name} ${value.text}`;
        } else if (key.startsWith('alias.')) {
          aliases.set(key.slice('alias.'.length), value.dynamic || name === '--config-env' ? undefined : (setting?.[2] ?? 'true'));
        } else {
          configOverride ||= PUSH_CONFIG.test(key);
          hooksOverride ??= key === HOOKS_PATH_KEY ? `${name} ${value.text}` : undefined;
        }
      }
    }
    const sub = words[index];
    if (sub === undefined) {
      return;
    }
    if (sub.dynamic) {
      this.doubt('the git command it runs is only known when it runs', true);
      return;
    }
    const state: GitState = { dir, gitDir, configOverride, aliases, aliasesUnknown, hooksOverride };
    const args = words.slice(index + 1);
    if (GIT_BUILTINS.has(sub.text)) {
      const hooks = hooksOverride === undefined ? {} : { hooksOverride };
      this.builtin({ dir: this.repoDir(state), subcommand: sub.text, args, configOverride, ...hooks }, depth);
    } else {
      this.alias(sub.text, args, state, depth, aliasDepth);
    }
  }

  private builtin(invocation: GitInvocation, depth: number): void {
    this.invocations.push(invocation);
    this.inheriting(invocation.hooksOverride, false, () => this.runsCommands(invocation, depth));
  }

  /** Reads the commands a git builtin runs itself, and records a `git config` alias; they inherit its hooks override. */
  private runsCommands(invocation: GitInvocation, depth: number): void {
    const { args, dir } = invocation;
    switch (invocation.subcommand) {
      case 'config':
        this.registerAlias(args);
        return;
      case 'submodule':
        this.submoduleForeach(args, depth);
        return;
      case 'rebase':
        this.rebaseExec(args, dir, depth);
        return;
      case 'bisect':
        if (args[0]?.text === 'run' && args.length > 1) {
          this.visitCommand(args.slice(1), 'bash', new Location(dir, this.context.home), depth + 1);
        }
        return;
      case 'filter-branch':
        args.forEach((arg, index) => {
          const filter = args[index + 1];
          if (FILTER_OPTIONS.has(arg.text) && filter !== undefined) {
            this.visitScript(filter, 'bash', new Location(undefined, this.context.home), depth + 1);
          }
        });
    }
  }

  /** Expands an alias; a name that is no alias is not a git command the guard reads (git extensions such as `git-foo` are not). */
  private alias(name: string, args: readonly ShellWord[], state: GitState, depth: number, aliasDepth: number): void {
    const key = name.toLowerCase();
    const repoDir = this.repoDir(state);
    let value: string | undefined;
    if (state.aliases.has(key)) {
      value = state.aliases.get(key);
    } else if (this.lineAliases.has(key)) {
      value = this.lineAliases.get(key);
    } else if (state.aliasesUnknown) {
      this.doubt(`"git ${name}" may be an alias a config override sets`, true);
      return;
    } else {
      const read = this.context.git.config(repoDir ?? this.context.cwd, `alias.${key}`);
      if (read.kind === 'unreadable') {
        this.doubt(`git could not read whether "git ${name}" is an alias`, false);
        return;
      }
      if (read.kind === 'unset') {
        if (repoDir === undefined) {
          this.doubt(`"git ${name}" may be an alias of a repository only known when it runs`, true);
        }
        return;
      }
      value = read.value;
    }
    if (value === undefined) {
      this.doubt(`"git ${name}" is an alias whose value is only known when it runs`, true);
      return;
    }
    if (aliasDepth >= MAX_ALIAS_DEPTH) {
      this.doubt('git aliases nest too deep to read', false);
      return;
    }
    this.mention(value);
    if (value.startsWith('!')) {
      const script = [value.slice(1), ...args.map(shellQuote)].join(' ');
      this.inheriting(state.hooksOverride, false, () => this.visitScript(staticWord(script), 'bash', new Location(repoDir, this.context.home), depth + 1));
      return;
    }
    const expanded = splitGitAlias(value);
    if (expanded.kind === 'refused') {
      this.doubt(expanded.reason, true);
      return;
    }
    this.visitGit([...expanded.words, ...args], state, depth, aliasDepth + 1);
  }

  /** Records `git config [set] alias.x value`, so a later `git x` in the same line expands. */
  private registerAlias(args: readonly ShellWord[]): void {
    const write = configWrite(args);
    if (write?.kind === 'set' && !write.key.dynamic && /^alias\./i.test(write.key.text)) {
      this.lineAliases.set(write.key.text.slice('alias.'.length).toLowerCase(), write.value.dynamic ? undefined : write.value.text);
    }
  }

  /** `git submodule [options] foreach [--recursive] <command>`: one word is a shell command, more are a program and its arguments. */
  private submoduleForeach(args: readonly ShellWord[], depth: number): void {
    let index = args.findIndex((arg) => !arg.text.startsWith('-'));
    if (index === -1 || args[index]?.text !== 'foreach') {
      return;
    }
    index += 1;
    while (args[index]?.text.startsWith('-') === true) {
      index += 1;
    }
    const command = args.slice(index);
    const location = new Location(undefined, this.context.home);
    const [only] = command;
    if (command.length === 1 && only !== undefined) {
      this.visitScript(only, 'bash', location, depth + 1);
    } else if (command.length > 1) {
      this.visitCommand(command, 'bash', location, depth + 1);
    }
  }

  /** `git rebase -x <cmd>` / `--exec <cmd>` runs each command in the shell after each commit. */
  private rebaseExec(args: readonly ShellWord[], dir: string | undefined, depth: number): void {
    for (let index = 0; index < args.length; index += 1) {
      const word = args[index] ?? staticWord('');
      const [name, attached] = splitOption(word.text);
      let command: ShellWord | undefined;
      if (name === '--exec' || name === '-x') {
        command = attached === undefined ? args[(index += 1)] : { text: attached, dynamic: word.dynamic };
      } else if (/^-x./s.test(word.text)) {
        command = { text: word.text.slice(2), dynamic: word.dynamic };
      }
      if (command !== undefined) {
        this.visitScript(command, 'bash', new Location(dir, this.context.home), depth + 1);
      }
    }
  }
}

/** Every git command `command` runs, and what the guard could not read; see {@link GitInvocationFinder}. */
export function findGitInvocations(command: string, context: FinderContext): GitInvocations {
  return new GitInvocationFinder(context).find(command);
}
