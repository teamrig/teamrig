import { errorCode, errorMessage } from "./guards.js";
import { powerShellRequest } from "./powershell.js";
/** A credential's name: letters, digits, `.`, `_` or `-`, so it never needs quoting on any command line. */
export const CREDENTIAL_NAME = /^[\w.-]{1,128}$/;
/** A token is printable ASCII with no spaces; anything else was saved some other way. */
const TOKEN_TEXT = /^[\x21-\x7e]+$/;
/** How long a store's tool may take to answer: a local read takes well under a second. */
export const CREDENTIAL_TIMEOUT_MS = 30_000;
/** `readFirst` over one read per name, for a store whose reads are quick. */
export async function readFirstOneByOne(read, names) {
    for (const [index, name] of names.entries()) {
        const found = await read(name);
        switch (found.kind) {
            case 'found':
                return { kind: 'found', index, secret: found.secret };
            case 'failed':
                return { kind: 'failed', index, reason: found.reason };
            case 'missing':
                break;
        }
    }
    return { kind: 'missing' };
}
/** The exit code the Windows script ends with when the credential does not exist. */
const WINDOWS_MISSING_EXIT = 3;
/**
 * Reads a generic credential through CredReadW. The secret leaves PowerShell as base64 on stdout, never in
 * argv, which other processes can read. cmdkey saves the blob as UTF-16LE and CredentialBlobSize counts bytes.
 */
export function windowsReadScript(name) {
    return `${WINDOWS_CRED_TYPE}
$secret = [TeamrigCredentials.Cred]::Read('${name}')
if ($null -eq $secret) { exit ${WINDOWS_MISSING_EXIT} }
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret)))
`;
}
/**
 * Reads `names` in order in one PowerShell run, which takes most of a second to start: the first one saved leaves as
 * `<index> <base64>`, and none saved ends with the missing exit. Each name was checked against CREDENTIAL_NAME first,
 * so it sits in single quotes with nothing to escape.
 */
export function windowsReadFirstScript(names) {
    const list = names.map((name) => `'${name}'`).join(', ');
    return `${WINDOWS_CRED_TYPE}
$names = @(${list})
for ($index = 0; $index -lt $names.Count; $index++) {
  $secret = [TeamrigCredentials.Cred]::Read($names[$index])
  if ($null -ne $secret) {
    [Console]::Out.Write("$index " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret)))
    exit 0
  }
}
exit ${WINDOWS_MISSING_EXIT}
`;
}
/** The CredReadW wrapper both Windows scripts load. */
const WINDOWS_CRED_TYPE = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace TeamrigCredentials {
  public static class Cred {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
      public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
      public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
      public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);
    public static string Read(string target) {
      IntPtr pointer;
      if (!CredReadW(target, 1, 0, out pointer)) return null;
      try {
        CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
        return Marshal.PtrToStringUni(credential.CredentialBlob, credential.CredentialBlobSize / 2);
      } finally { CredFree(pointer); }
    }
  }
}
'@`;
const WINDOWS = {
    label: 'the Windows Credential Manager',
    program: 'powershell.exe',
    writer: 'cmdkey',
    saveArgs: (name) => [`/generic:${name}`, '/user:teamrig', '/pass'],
    removeArgs: (name) => [`/delete:${name}`],
    request: (name) => powerShellRequest(windowsReadScript(name)),
    missing: (result) => result.end.kind === 'exited' && result.end.code === WINDOWS_MISSING_EXIT,
    secretOf: (stdout) => Buffer.from(stdout.trim(), 'base64').toString('utf8'),
};
/** `security` exits 44 when the keychain has no such item. */
const MACOS_MISSING_EXIT = 44;
const MACOS = {
    label: 'the macOS keychain',
    program: 'security',
    writer: 'security',
    saveArgs: (name) => ['add-generic-password', '-U', '-s', name, '-a', 'teamrig', '-w'],
    // By service name alone, as the read finds it, so a key saved under another account name goes too.
    removeArgs: (name) => ['delete-generic-password', '-s', name],
    request: (name) => ({ program: 'security', args: ['find-generic-password', '-s', name, '-w'] }),
    missing: (result) => result.end.kind === 'exited' && result.end.code === MACOS_MISSING_EXIT,
    secretOf: (stdout) => stdout.trimEnd(),
};
/** libsecret's `secret-tool` exits 1 and prints nothing when no item matches; an error (no keyring running) prints why. */
const LINUX = {
    label: 'the Secret Service keyring',
    program: 'secret-tool',
    writer: 'secret-tool',
    saveArgs: (name) => ['store', `--label=${name}`, 'service', name],
    removeArgs: (name) => ['clear', 'service', name],
    request: (name) => ({ program: 'secret-tool', args: ['lookup', 'service', name] }),
    missing: (result) => result.end.kind === 'exited' && result.end.code === 1 && result.stdout === '' && result.stderr.trim() === '',
    secretOf: (stdout) => stdout.trimEnd(),
};
function toolFor(platform) {
    switch (platform) {
        case 'win32':
            return WINDOWS;
        case 'darwin':
            return MACOS;
        default:
            return LINUX;
    }
}
/** The store of the operating system teamrig runs on, read through its own command-line tool. */
export function systemCredentials(platform, run) {
    const tool = toolFor(platform);
    const read = (name) => readWith(tool, run, name);
    return {
        label: tool.label,
        saveCommand: (name) => saveCommandOf(tool, name),
        read,
        readFirst: (names) => (tool === WINDOWS ? windowsReadFirst(run, names) : readFirstOneByOne(read, names)),
    };
}
/**
 * The writes to the store of the operating system teamrig runs on, through its own command-line tool, started from the
 * absolute path `writer` finds and never by its bare name.
 */
export function systemCredentialKeeper(platform, run, writer) {
    const tool = toolFor(platform);
    return {
        label: tool.label,
        saveRequest: async (name) => {
            const found = await writer();
            return found.kind === 'found' ? { kind: 'ready', request: { program: found.path, args: tool.saveArgs(name) } } : found;
        },
        remove: (name) => removeWith(tool, run, writer, name),
    };
}
/** The save command as a person types it; every part is a credential name or a fixed word, so none needs quoting. */
function saveCommandOf(tool, name) {
    return [tool.writer, ...tool.saveArgs(name)].join(' ');
}
async function removeWith(tool, run, writer, name) {
    if (!CREDENTIAL_NAME.test(name)) {
        return { kind: 'failed', reason: `${JSON.stringify(name)} is not a credential name: letters, digits, '.', '_' or '-'` };
    }
    const found = await writer();
    if (found.kind === 'refused') {
        return { kind: 'failed', reason: found.reason };
    }
    const request = { program: found.path, args: tool.removeArgs(name) };
    let result;
    try {
        result = await run(request);
    }
    catch (error) {
        return { kind: 'failed', reason: `${request.program} could not start: ${errorMessage(error)}` };
    }
    if (result.end.kind === 'exited' && result.end.code === 0) {
        return { kind: 'removed' };
    }
    // cmdkey prints its errors on stdout.
    return { kind: 'failed', reason: `${request.program} ${endText(result.end)}: ${firstLine(result.stderr === '' ? result.stdout : result.stderr)}` };
}
/**
 * `readFirst` in one PowerShell run. A name that is no credential name fails at its place, and only the names before
 * it are read, so the order still decides; a run that fails is a failure at the first name, so no wider key stands in.
 */
async function windowsReadFirst(run, names) {
    const bad = names.findIndex((name) => !CREDENTIAL_NAME.test(name));
    const asked = bad === -1 ? names : names.slice(0, bad);
    const found = asked.length === 0 ? { kind: 'missing' } : await windowsRun(run, asked);
    if (found.kind !== 'missing' || bad === -1) {
        return found;
    }
    return { kind: 'failed', index: bad, reason: `${JSON.stringify(names[bad])} is not a credential name: letters, digits, '.', '_' or '-'` };
}
async function windowsRun(run, names) {
    let result;
    try {
        result = await run(powerShellRequest(windowsReadFirstScript(names)));
    }
    catch (error) {
        return { kind: 'failed', index: 0, reason: `${WINDOWS.program} could not start: ${errorMessage(error)}` };
    }
    if (WINDOWS.missing(result)) {
        return { kind: 'missing' };
    }
    if (result.end.kind !== 'exited' || result.end.code !== 0) {
        return { kind: 'failed', index: 0, reason: `${WINDOWS.program} ${endText(result.end)}: ${firstLine(result.stderr)}` };
    }
    const answer = /^(\d+) ([A-Za-z0-9+/=]*)$/u.exec(result.stdout.trim());
    const index = answer?.[1] === undefined ? -1 : Number(answer[1]);
    const name = names[index];
    if (answer?.[2] === undefined || name === undefined) {
        return { kind: 'failed', index: 0, reason: `${WINDOWS.program} gave no answer teamrig reads` };
    }
    const secret = WINDOWS.secretOf(answer[2]);
    return TOKEN_TEXT.test(secret)
        ? { kind: 'found', index, secret }
        : { kind: 'failed', index, reason: `credential ${name} does not hold a token: save it again with ${saveCommandOf(WINDOWS, name)}` };
}
async function readWith(tool, run, name) {
    if (!CREDENTIAL_NAME.test(name)) {
        return { kind: 'failed', reason: `${JSON.stringify(name)} is not a credential name: letters, digits, '.', '_' or '-'` };
    }
    let result;
    try {
        result = await run(tool.request(name));
    }
    catch (error) {
        // With no tool to save one (Linux without libsecret's secret-tool), no credential can exist.
        return errorCode(error) === 'ENOENT' ? { kind: 'missing' } : { kind: 'failed', reason: `${tool.program} could not start: ${errorMessage(error)}` };
    }
    if (tool.missing(result)) {
        return { kind: 'missing' };
    }
    if (result.end.kind !== 'exited' || result.end.code !== 0) {
        return { kind: 'failed', reason: `${tool.program} ${endText(result.end)}: ${firstLine(result.stderr)}` };
    }
    const secret = tool.secretOf(result.stdout);
    if (!TOKEN_TEXT.test(secret)) {
        return { kind: 'failed', reason: `credential ${name} does not hold a token: save it again with ${saveCommandOf(tool, name)}` };
    }
    return { kind: 'found', secret };
}
function endText(end) {
    return end.kind === 'exited' ? `exited ${end.code}` : `was stopped (${end.signal})`;
}
function firstLine(text) {
    return text.split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? 'no error text';
}
