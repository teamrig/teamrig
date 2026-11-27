/** A command line the CLI cannot act on: it prints the message and its command's usage, and exits 64. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
  /** The command or group word the line named, when known, so only that command's usage is printed. */
  readonly command: string | undefined;

  constructor(message: string, command?: string) {
    super(message);
    this.command = command;
  }
}

/** Asks for the help of the command they follow, wherever a flag or word could stand: `set --help`, `inbox -h`. */
export const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h']);

export type Flags = ReadonlyMap<string, string>;

export interface ParsedArgs {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Flags;
  /** The flags given that take no value, such as `--ready`. */
  readonly switches: ReadonlySet<string>;
  /** The words after `--`, passed on untouched: flags, `--help` and quotes included; empty without a `--`. */
  readonly rest: readonly string[];
  /** True when `--` appeared on a command that accepts `rest`, even with zero words after it. */
  readonly restMarker?: boolean;
  /** `--help` or `-h` followed the command: print its help and nothing else; `command` may then be a group word. */
  readonly help: boolean;
  /**
   * `--session` and `--team` given to a command that does not declare them (`COMMON_FLAGS`, #654): kept out of `flags`,
   * so every reader of the line (the command, `readable` in src/slash/plan.ts) sees it as the command runs it; only
   * `runCli` checks them.
   */
  readonly common: Flags;
  /**
   * `--host-event <event>` on a `hook` command: the event a host whose hook input names none (Antigravity CLI) wrote
   * into the hook's command line. Kept out of `flags`, as every hook takes it and none reads it itself: `runCli` hands
   * it to the host's hook bridge. Undefined when the line gave none.
   */
  readonly hostEvent?: string | undefined;
  /**
   * `--host <id>` on any command: the host adapter the process runs under, which a host's hooks file writes into each
   * hook's command line. Kept out of `flags`, as no command reads it itself: `runCli` loads that host for the run
   * (src/cli/host-choice.ts). Undefined when the line gave none.
   */
  readonly host?: string | undefined;
}

/** Each command's accepted flags, keyed by the command's words: `add`, `inbox read`. */
export type CommandFlags = Readonly<Partial<Record<string, readonly string[]>>>;

/** Each command's flags that take no value, keyed like `CommandFlags`; most commands have none. */
export type CommandSwitches = CommandFlags;

/** The commands that take `--` and a command line after it, such as `test -- npm test`; on any other `--` is refused. */
export type CommandRest = ReadonlySet<string>;

/**
 * The flags every command reads (#654): the caller and its team. A command that takes them for its own use lists them
 * in its flags; on any other, `runCli` checks them (src/cli/common-flags.ts) and the command ignores them.
 */
export const COMMON_FLAGS: readonly string[] = ['session', 'team'];

/** The flag every `hook` command takes for the host's event name (`ParsedArgs.hostEvent`). */
export const HOST_EVENT_FLAG = 'host-event';

/** The flag every command takes for the host it runs under (`ParsedArgs.host`). */
export const HOST_FLAG = 'host';

/** The commands run as a host's hooks, which take `--host-event`. */
export function isHookCommand(command: string): boolean {
  return command.startsWith('hook ');
}

/** Ends a command's own flags: every word after it belongs to the command line it runs. */
export const REST_MARKER = '--';

/**
 * What running a command does. `read` changes nothing; `write` changes the team's files or acts on the
 * machine (`inbox read` and `start` mark inbox lines read, `open` starts a tab, `test` runs a command);
 * `internal` is run by Claude Code, the plugin's mod or another teamrig command, never typed by a person.
 */
export type CommandEffect = 'read' | 'write' | 'internal';

/** Each command's effect, keyed like `CommandFlags`. */
export type CommandEffects = Readonly<Partial<Record<string, CommandEffect>>>;

/**
 * Flags that were renamed, old name to new name. The old name is refused on every command with the
 * new one to use; it is never read as an alias, so one spelling stays in scripts and docs.
 */
export type RenamedFlags = Readonly<Partial<Record<string, string>>>;

/**
 * Commands that were renamed, old command to new, refused like a renamed flag: `integrate` to `merge`. An old name of
 * two words (`gh sync`) is read before any command, so a first word reused by a new command keeps its old lines' hint.
 */
export type RenamedCommands = Readonly<Partial<Record<string, string>>>;

/** The renamed flags and commands a line is read with. */
export interface Renamed {
  readonly flags?: RenamedFlags;
  readonly commands?: RenamedCommands;
}

/** The command a line names: two words when they form a command (`inbox read`), else one; a group word before `--help`. */
function commandOf(
  argv: readonly string[],
  commandFlags: CommandFlags,
  renamedCommands: RenamedCommands,
): { readonly command: string; readonly tail: readonly string[] } {
  const [first = '', second] = argv;
  const pair = `${first} ${second ?? ''}`;
  const renamedPair = second === undefined ? undefined : renamedCommands[pair];
  if (renamedPair !== undefined) {
    throw new UsageError(`${pair} was renamed: use ${renamedPair}`);
  }
  if (second !== undefined && commandFlags[pair] !== undefined) {
    return { command: pair, tail: argv.slice(2) };
  }
  if (commandFlags[first] !== undefined) {
    return { command: first, tail: argv.slice(1) };
  }
  if (first === '') {
    throw new UsageError('no command given');
  }
  const actions = Object.keys(commandFlags)
    .filter((name) => name.startsWith(`${first} `))
    .map((name) => name.slice(first.length + 1));
  if (actions.length === 0) {
    const renamed = renamedCommands[first];
    throw new UsageError(renamed === undefined ? `unknown command "${first}"` : `${first} was renamed: use ${renamed}`);
  }
  if (second !== undefined && HELP_FLAGS.has(second)) {
    return { command: first, tail: argv.slice(1) };
  }
  throw new UsageError(`${first} ${actions.join('|')}`, first);
}

/**
 * Splits `<command> [words] [--name value] [--switch]...`. Only the command's own flags and COMMON_FLAGS are
 * accepted, so a typo is refused instead of silently meaning nothing; every flag takes exactly one
 * value, except the command's switches, which take none. A renamed flag or command is refused with its
 * new name. `--help` or `-h` after the command stops the reading: the line asks for that command's help.
 * On a command that takes a command line, `--` ends the reading too: the words after it are its `rest`.
 */
export function parseArgs(
  argv: readonly string[],
  commandFlags: CommandFlags,
  commandSwitches: CommandSwitches = {},
  renamed: Renamed = {},
  restCommands: CommandRest = new Set(),
): ParsedArgs {
  const renamedFlags = renamed.flags ?? {};
  const { command, tail } = commandOf(argv, commandFlags, renamed.commands ?? {});
  const allowed = commandFlags[command] ?? [];
  const switchable = commandSwitches[command] ?? [];
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  const common = new Map<string, string>();
  const switches = new Set<string>();
  // The flags a host writes into a command line, which no command reads itself: one value each, never in `flags`.
  const hostFlags = new Map<string, string>();
  const hostFlagNamed = (name: string): boolean =>
    !allowed.includes(name) && (name === HOST_FLAG || (name === HOST_EVENT_FLAG && isHookCommand(command)));
  const parsed = (rest: readonly string[], restMarker = false): ParsedArgs => ({
    command,
    positionals,
    flags,
    switches,
    rest,
    ...(restMarker ? { restMarker: true } : {}),
    help: false,
    common,
    hostEvent: hostFlags.get(HOST_EVENT_FLAG),
    host: hostFlags.get(HOST_FLAG),
  });
  for (let index = 0; index < tail.length; index += 1) {
    const token = tail[index] ?? '';
    if (HELP_FLAGS.has(token)) {
      return { command, positionals: [], flags: new Map(), switches: new Set(), rest: [], help: true, common: new Map() };
    }
    if (token === REST_MARKER && restCommands.has(command)) {
      return parsed(tail.slice(index + 1), true);
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const renamed = renamedFlags[name];
    if (renamed !== undefined) {
      throw new UsageError(`${token} was renamed: use --${renamed}`, command);
    }
    if (switchable.includes(name)) {
      if (switches.has(name)) {
        throw new UsageError(`${token} is given twice`, command);
      }
      switches.add(name);
      continue;
    }
    const hostFlag = hostFlagNamed(name);
    if (!allowed.includes(name) && !COMMON_FLAGS.includes(name) && !hostFlag) {
      throw new UsageError(`${command} takes no ${token}`, command);
    }
    const value = tail[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${token} needs a value`, command);
    }
    if (hostFlag) {
      if (hostFlags.has(name)) {
        throw new UsageError(`${token} is given twice`, command);
      }
      hostFlags.set(name, value);
      index += 1;
      continue;
    }
    if (flags.has(name) || common.has(name)) {
      throw new UsageError(`${token} is given twice`, command);
    }
    (allowed.includes(name) ? flags : common).set(name, value);
    index += 1;
  }
  return parsed([]);
}

export function noPositionals(args: ParsedArgs): void {
  const [extra] = args.positionals;
  if (extra !== undefined) {
    throw new UsageError(`unexpected "${extra}"`);
  }
}

/** The command's positional words, at least one, such as task ids. */
export function somePositionals(args: ParsedArgs, name: string): readonly string[] {
  if (args.positionals.length === 0) {
    throw new UsageError(`${args.command} needs <${name}>`);
  }
  return args.positionals;
}

/** The command's single positional word, such as a task id. */
export function onePositional(args: ParsedArgs, name: string): string {
  const [value, extra] = args.positionals;
  if (value === undefined) {
    throw new UsageError(`${args.command} needs <${name}>`);
  }
  if (extra !== undefined) {
    throw new UsageError(`unexpected "${extra}"`);
  }
  return value;
}

export function requiredFlag(flags: Flags, name: string): string {
  const value = flags.get(name);
  if (value === undefined) {
    throw new UsageError(`--${name} is required`);
  }
  return value;
}
