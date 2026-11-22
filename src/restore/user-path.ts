import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { powerShellRequest } from '../core/powershell.ts';
import type { ProgramRunner } from '../core/program-runner.ts';
import { powerShellOutput } from './powershell-output.ts';

/**
 * The user's own PATH, the one each terminal they open starts with: teamrig adds its bin folder to it, so `teamrig`
 * runs from any terminal (cli-on-path.ts). A terminal open already keeps the PATH it started with.
 */
export interface UserPath {
  /** Where the PATH lives, as the person would look it up. */
  readonly where: string;
  /** Whether terminals opened from now on find programs in `folder`. */
  holds(folder: string): Promise<boolean>;
  /** Makes terminals opened from now on find programs in `folder`, keeping every entry the PATH has. */
  add(folder: string): Promise<void>;
}

export const USER_PATH_TIMEOUT_MS = 30_000;

/** Where Windows keeps the user's PATH: the `Path` value of the user's Environment key. */
export const WINDOWS_ENVIRONMENT_KEY = 'HKCU\\Environment';

/**
 * Prints the user's `Path` value as it is stored, `%USERPROFILE%` and the like unexpanded, as UTF-8 base64, so no
 * console code page can change a character; nothing when there is none.
 */
export const WINDOWS_READ_PATH_SCRIPT = `$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
if ($null -ne $key) {
  try {
    $path = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($null -ne $path) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$path)) }
  } finally { $key.Close() }
}
`;

/**
 * Adds `folder` at the end of the user's `Path` value unless an entry names it already (any case), keeping the value's
 * kind, so `%USERPROFILE%` entries stay ones Windows expands, then tells running programs the environment changed, so
 * Explorer starts new terminals with it. `setx` is not used: it cuts the value at 1024 characters and stores it
 * expanded.
 */
export function windowsAddPathScript(folder: string): string {
  const encoded = Buffer.from(folder, 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
$folder = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  $path = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  if (@($path.Split(';') | ForEach-Object { $_.TrimEnd('\\') }) -notcontains $folder.TrimEnd('\\')) {
    $joined = if ($path -eq '') { $folder } elseif ($path.EndsWith(';')) { $path + $folder } else { $path + ';' + $folder }
    $key.SetValue('Path', $joined, $kind)
  }
} finally { $key.Close() }
Add-Type -Namespace Teamrig -Name EnvironmentBroadcast -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
$result = [UIntPtr]::Zero
[void][Teamrig.EnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
`;
}

/** Whether a Windows PATH value holds `folder`: an entry equal to it in any case, a trailing backslash aside. */
export function windowsPathHolds(path: string, folder: string): boolean {
  const wanted = folder.replace(/\\+$/, '').toLowerCase();
  return path.split(';').some((entry) => entry.trim().replace(/\\+$/, '').toLowerCase() === wanted);
}

function windowsUserPath(run: ProgramRunner): UserPath {
  return {
    where: `${WINDOWS_ENVIRONMENT_KEY} Path`,
    async holds(folder) {
      const printed = powerShellOutput(await run(powerShellRequest(WINDOWS_READ_PATH_SCRIPT))).trim();
      return printed !== '' && windowsPathHolds(Buffer.from(printed, 'base64').toString('utf8'), folder);
    },
    async add(folder) {
      powerShellOutput(await run(powerShellRequest(windowsAddPathScript(folder))));
    },
  };
}

/** The first and last lines of the block teamrig keeps in a shell's start file; it rewrites what lies between. */
export const SHELL_BLOCK_START = '# >>> teamrig: its CLI on the PATH (teamrig rewrites this block) >>>';
export const SHELL_BLOCK_END = '# <<< teamrig <<<';

/** `text` inside sh double quotes: `\`, `"`, `$` and a backtick escaped. */
function doubleQuoted(text: string): string {
  return `"${text.replace(/[\\"$`]/g, (char) => `\\${char}`)}"`;
}

/** The block that puts `folder` first on the PATH of a shell reading the file, once however often it is read. */
export function shellBlock(folder: string): string {
  const quoted = doubleQuoted(folder);
  return [
    SHELL_BLOCK_START,
    `case ":$PATH:" in *:${quoted}:*) ;; *) PATH=${quoted}:"$PATH"; export PATH ;; esac`,
    SHELL_BLOCK_END,
  ].join('\n');
}

/** `text` with its teamrig block made `block`: the one there replaced, else added at the end. */
export function withShellBlock(text: string, block: string): string {
  const start = text.indexOf(SHELL_BLOCK_START);
  const end = start === -1 ? -1 : text.indexOf(SHELL_BLOCK_END, start);
  if (start !== -1 && end !== -1) {
    return text.slice(0, start) + block + text.slice(end + SHELL_BLOCK_END.length);
  }
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${separator}${text === '' ? '' : '\n'}${block}\n`;
}

/**
 * The start files the block goes in: `~/.profile`, which login shells read, always; `~/.bash_profile`, which bash
 * reads in place of it, and `~/.bashrc`, which interactive bash reads, where they exist; `~/.zshrc`, which zsh reads,
 * where it exists, and always on macOS, whose default shell is zsh.
 */
async function shellStartFiles(files: Files, userHome: string, platform: NodeJS.Platform): Promise<string[]> {
  const wanted: string[] = [join(userHome, '.profile')];
  for (const name of ['.bash_profile', '.bashrc', '.zshrc']) {
    const path = join(userHome, name);
    if ((await files.read(path)) !== undefined || (name === '.zshrc' && platform === 'darwin')) {
      wanted.push(path);
    }
  }
  return wanted;
}

function shellUserPath(files: Files, userHome: string, platform: NodeJS.Platform): UserPath {
  const lacking = async (folder: string): Promise<string[]> => {
    const block = shellBlock(folder);
    const paths = await shellStartFiles(files, userHome, platform);
    const texts = await Promise.all(paths.map(async (path) => ({ path, text: await files.read(path) })));
    return texts.filter(({ text }) => text === undefined || !text.includes(block)).map(({ path }) => path);
  };
  return {
    where: join(userHome, '.profile'),
    async holds(folder) {
      return (await lacking(folder)).length === 0;
    },
    async add(folder) {
      const block = shellBlock(folder);
      for (const path of await lacking(folder)) {
        await files.write(path, withShellBlock((await files.read(path)) ?? '', block));
      }
    },
  };
}

/** The user's PATH: on Windows the Environment key's value, elsewhere a block in the shells' start files. */
export function systemUserPath(platform: NodeJS.Platform, run: ProgramRunner, files: Files, userHome: string): UserPath {
  return platform === 'win32' ? windowsUserPath(run) : shellUserPath(files, userHome, platform);
}
